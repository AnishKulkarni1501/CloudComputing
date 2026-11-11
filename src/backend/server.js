const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || !process.env.MONGODB_URI)) {
  throw new Error('JWT_SECRET and MONGODB_URI must be configured in production');
}
if (process.env.NODE_ENV === 'production' && !process.env.S3_BUCKET) {
  throw new Error('S3_BUCKET must be configured in production');
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
const uploadDirectory = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
app.use('/uploads', express.static(uploadDirectory, { fallthrough: false, maxAge: '1h' }));

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-south-1';
const s3Bucket = process.env.S3_BUCKET;
const s3Client = new S3Client({ region });
const sqsClient = new SQSClient({ region });
const localUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, callback) => {
    const allowedTypes = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/;
    callback(allowedTypes.test(file.mimetype) ? null : new Error('Only JPEG, PNG, GIF, WebP, MP4, WebM, and MOV files are allowed'), allowedTypes.test(file.mimetype));
  }
});

const publishForumEvent = async (eventType, payload) => {
  await publishQueueEvent(process.env.FORUM_EVENTS_QUEUE_URL, eventType, payload);
};

const publishQueueEvent = async (queueUrl, eventType, payload) => {
  if (!queueUrl) return;
  try {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(), ...payload })
    }));
  } catch (error) {
    // The database write has succeeded; keep the user request successful and make delivery failure visible.
    console.error(`Could not publish ${eventType} event:`, error);
  }
};

const supportedMediaTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']);
const maxMediaBytes = 100 * 1024 * 1024;
const sanitizeMedia = (items, userId) => {
  if (items === undefined) return undefined;
  if (!Array.isArray(items) || items.length > 5) throw new Error('A post can have up to 5 attachments');
  return items.map(item => {
    const key = String(item.key || '');
    const contentType = String(item.contentType || '');
    const size = Number(item.size);
    const ownedS3Key = key.startsWith(`${userId}/`);
    const localKey = process.env.NODE_ENV !== 'production' && /^local\/[a-zA-Z0-9._-]+$/.test(key);
    if ((!ownedS3Key && !localKey) || !supportedMediaTypes.has(contentType) || !Number.isFinite(size) || size < 1 || size > maxMediaBytes) {
      throw new Error('Invalid or unauthorized media attachment');
    }
    return { key, contentType, size, originalName: String(item.originalName || 'upload').slice(0, 200) };
  });
};

const hydratePostMedia = async (post, req) => {
  const result = post.toObject ? post.toObject() : { ...post };
  result.media = await Promise.all((result.media || []).map(async item => {
    let url;
    if (item.key.startsWith('local/')) {
      url = `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(path.basename(item.key))}`;
    } else if (s3Bucket) {
      url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: s3Bucket, Key: item.key }), { expiresIn: 1800 });
    }
    return { ...item, url };
  }));
  return result;
};
app.get('/health', (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({ status: databaseReady ? 'ok' : 'starting', database: databaseReady ? 'connected' : 'disconnected' });
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/forum')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Comment Schema
const commentSchema = new mongoose.Schema({
  content: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorUsername: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const mediaSchema = new mongoose.Schema({
  key: { type: String, required: true },
  contentType: { type: String, required: true },
  size: { type: Number, required: true },
  originalName: { type: String, required: true }
}, { _id: false });

// Post Schema
const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorUsername: { type: String, required: true },
  upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [commentSchema],
  media: [mediaSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

// Auth Middleware
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) throw new Error();
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'local-development-secret-change-me');
    const user = await User.findById(decoded.userId);
    
    if (!user) throw new Error();
    
    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};

// Local uploads keep the feature usable without AWS. Production uploads use short-lived S3 URLs.
app.post('/api/media/presign', auth, async (req, res) => {
  try {
    if (!s3Bucket) return res.status(503).json({ error: 'S3 media storage is not configured' });
    const { originalName, contentType, size } = req.body;
    if (!supportedMediaTypes.has(contentType) || !Number.isFinite(Number(size)) || Number(size) < 1 || Number(size) > maxMediaBytes) {
      return res.status(400).json({ error: 'Unsupported file type or size; files must be up to 100 MB' });
    }
    const extension = path.extname(String(originalName || '')).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 12);
    const key = `${req.userId}/${randomUUID()}${extension}`;
    const { url: uploadUrl, fields } = await createPresignedPost(s3Client, {
      Bucket: s3Bucket,
      Key: key,
      Expires: 300,
      Fields: { 'Content-Type': contentType },
      Conditions: [
        ['content-length-range', 1, maxMediaBytes],
        ['eq', '$Content-Type', contentType]
      ]
    });
    res.json({ uploadUrl, fields, key, contentType, size: Number(size), originalName: String(originalName || 'upload').slice(0, 200) });
  } catch (error) {
    res.status(500).json({ error: 'Could not prepare the S3 upload' });
  }
});

app.post('/api/media/confirm', auth, async (req, res) => {
  try {
    if (!s3Bucket) return res.status(503).json({ error: 'S3 media storage is not configured' });
    const key = String(req.body.key || '');
    if (!key.startsWith(`${req.userId}/`)) return res.status(403).json({ error: 'Not authorized to use this upload' });
    const object = await s3Client.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }));
    if (!supportedMediaTypes.has(object.ContentType) || !object.ContentLength || object.ContentLength > maxMediaBytes) {
      return res.status(400).json({ error: 'Uploaded file type or size is not allowed' });
    }
    const media = { key, contentType: object.ContentType, size: object.ContentLength, originalName: String(req.body.originalName || 'upload').slice(0, 200) };
    await publishQueueEvent(process.env.MEDIA_JOBS_QUEUE_URL, 'media.uploaded', { media });
    res.json(media);
  } catch (error) {
    res.status(400).json({ error: 'Upload was not found or could not be verified' });
  }
});

app.post('/api/media/local', auth, (req, res, next) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Local media uploads are disabled in production' });
  next();
}, localUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a photo or video to upload' });
    const extension = path.extname(req.file.originalname).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 12);
    const fileName = `${randomUUID()}${extension}`;
    await fs.promises.writeFile(path.join(uploadDirectory, fileName), req.file.buffer, { flag: 'wx' });
    res.status(201).json({ key: `local/${fileName}`, contentType: req.file.mimetype, size: req.file.size, originalName: req.file.originalname.slice(0, 200) });
  } catch (error) {
    res.status(500).json({ error: 'Could not save uploaded file' });
  }
});

// Sign Up
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'local-development-secret-change-me', { expiresIn: '1d' });
    res.status(201).json({ token, user: { id: user._id, username: user.username, email: user.email } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Sign In
app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'local-development-secret-change-me', { expiresIn: '1d' });
    res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get Current User
app.get('/api/auth/me', auth, async (req, res) => {
  res.json({ user: { id: req.user._id, username: req.user.username, email: req.user.email } });
});

// Get All Posts
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json(await Promise.all(posts.map(post => hydratePostMedia(post, req))));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Post
app.post('/api/posts', auth, async (req, res) => {
  try {
    const { title, content } = req.body;
    const post = new Post({
      title,
      content,
      author: req.userId,
      authorUsername: req.user.username,
      media: sanitizeMedia(req.body.media || [], req.userId)
    });
    await post.save();
    await publishForumEvent('post.created', { postId: post._id.toString(), authorId: req.userId.toString() });
    res.status(201).json(await hydratePostMedia(post, req));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update Post
app.put('/api/posts/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    if (post.author.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    post.title = req.body.title || post.title;
    post.content = req.body.content || post.content;
    const media = sanitizeMedia(req.body.media, req.userId);
    if (media !== undefined) post.media = media;
    post.updatedAt = Date.now();
    await post.save();
    await publishForumEvent('post.updated', { postId: post._id.toString(), authorId: req.userId.toString() });
    res.json(await hydratePostMedia(post, req));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete Post
app.delete('/api/posts/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    if (post.author.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await Post.findByIdAndDelete(req.params.id);
    await publishForumEvent('post.deleted', { postId: req.params.id, authorId: req.userId.toString() });
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Upvote Post
app.post('/api/posts/:id/upvote', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    const hasUpvoted = post.upvotes.includes(req.userId);
    
    if (hasUpvoted) {
      post.upvotes = post.upvotes.filter(id => id.toString() !== req.userId.toString());
    } else {
      post.upvotes.push(req.userId);
    }
    
    await post.save();
    await publishForumEvent('post.upvote_changed', { postId: post._id.toString(), userId: req.userId.toString(), upvoted: !hasUpvoted });
    res.json(post);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Add Comment
app.post('/api/posts/:id/comments', auth, async (req, res) => {
  try {
    const content = String(req.body.content || '').trim();
    if (!content || content.length > 2000) return res.status(400).json({ error: 'Comment must be between 1 and 2000 characters' });
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    const comment = {
      content,
      author: req.userId,
      authorUsername: req.user.username,
      updatedAt: Date.now()
    };
    
    post.comments.push(comment);
    await post.save();
    const newComment = post.comments[post.comments.length - 1];
    await publishForumEvent('comment.created', { postId: post._id.toString(), commentId: newComment._id.toString(), authorId: req.userId.toString() });
    res.status(201).json(post);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Edit Comment
app.put('/api/posts/:postId/comments/:commentId', auth, async (req, res) => {
  try {
    const content = String(req.body.content || '').trim();
    if (!content || content.length > 2000) return res.status(400).json({ error: 'Comment must be between 1 and 2000 characters' });
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.author.toString() !== req.userId.toString()) return res.status(403).json({ error: 'Not authorized' });
    comment.content = content;
    comment.updatedAt = new Date();
    await post.save();
    await publishForumEvent('comment.updated', { postId: post._id.toString(), commentId: comment._id.toString(), authorId: req.userId.toString() });
    res.json(await hydratePostMedia(post, req));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete Comment
app.delete('/api/posts/:postId/comments/:commentId', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    
    if (comment.author.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    comment.deleteOne();
    await post.save();
    await publishForumEvent('comment.deleted', { postId: post._id.toString(), commentId: req.params.commentId, authorId: req.userId.toString() });
    res.json(post);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof multer.MulterError ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : (error.status || 400);
  res.status(status).json({ error: error.message || 'Request could not be processed' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

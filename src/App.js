import React, { useState, useEffect } from 'react';
import { MessageSquare, ThumbsUp, Trash2, Edit2, Plus, X, LogOut, Send } from 'lucide-react';
import './App.css';

const API_URL = `${(process.env.REACT_APP_API_URL || 'http://localhost:5000').replace(/\/$/, '')}/api`;

function App() {
  const [posts, setPosts] = useState([]);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [expandedComments, setExpandedComments] = useState({});
  const [commentInputs, setCommentInputs] = useState({});
  const [editingComment, setEditingComment] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isSavingPost, setIsSavingPost] = useState(false);
  
  const [authForm, setAuthForm] = useState({ username: '', email: '', password: '' });
  const [postForm, setPostForm] = useState({ title: '', content: '', media: [] });
  const [sortBy, setSortBy] = useState('new');

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchUser();
    }
    fetchPosts();
  }, [token]);

  const fetchUser = async () => {
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        logout();
      }
    } catch (error) {
      console.error('Error fetching user:', error);
    }
  };

  const fetchPosts = async () => {
    try {
      const res = await fetch(`${API_URL}/posts`);
      const data = await res.json();
      setPosts(data);
    } catch (error) {
      console.error('Error fetching posts:', error);
    }
  };

  const handleAuth = async () => {
    const endpoint = isSignUp ? 'signup' : 'signin';
    try {
      const body = isSignUp 
        ? authForm 
        : { email: authForm.email, password: authForm.password };
      
      const res = await fetch(`${API_URL}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setUser(data.user);
        setShowAuthModal(false);
        setAuthForm({ username: '', email: '', password: '' });
      } else {
        alert(data.error);
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  const uploadPostFiles = async () => {
    const uploaded = [];
    for (const file of selectedFiles) {
      if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name} is larger than the 100 MB limit`);
      const metadata = { originalName: file.name, contentType: file.type, size: file.size };
      const presignResponse = await fetch(`${API_URL}/media/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(metadata)
      });

      if (presignResponse.status === 503) {
        const form = new FormData();
        form.append('file', file);
        const localResponse = await fetch(`${API_URL}/media/local`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: form
        });
        const localData = await localResponse.json();
        if (!localResponse.ok) throw new Error(localData.error || `Could not upload ${file.name}`);
        uploaded.push(localData);
        continue;
      }

      const presignData = await presignResponse.json();
      if (!presignResponse.ok) throw new Error(presignData.error || `Could not prepare ${file.name}`);
      const s3Form = new FormData();
      Object.entries(presignData.fields).forEach(([key, value]) => s3Form.append(key, value));
      s3Form.append('file', file);
      const uploadResponse = await fetch(presignData.uploadUrl, { method: 'POST', body: s3Form });
      if (!uploadResponse.ok) throw new Error(`S3 upload failed for ${file.name}`);
      const confirmResponse = await fetch(`${API_URL}/media/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ key: presignData.key, originalName: file.name })
      });
      const confirmData = await confirmResponse.json();
      if (!confirmResponse.ok) throw new Error(confirmData.error || `Could not verify ${file.name}`);
      uploaded.push(confirmData);
    }
    return [...(postForm.media || []), ...uploaded];
  };

  const handleCreatePost = async () => {
    if (!postForm.title.trim() || !postForm.content.trim()) return;
    
    try {
      setIsSavingPost(true);
      const media = await uploadPostFiles();
      const res = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ...postForm, media })
      });
      const data = await res.json();
      if (res.ok) {
        await fetchPosts();
        setShowPostModal(false);
        setPostForm({ title: '', content: '', media: [] });
        setSelectedFiles([]);
      } else {
        throw new Error(data.error || 'Could not create post');
      }
    } catch (error) {
      alert(error.message || 'Error creating post');
    } finally {
      setIsSavingPost(false);
    }
  };

  const handleUpdatePost = async () => {
    if (!postForm.title.trim() || !postForm.content.trim()) return;
    
    try {
      setIsSavingPost(true);
      const media = await uploadPostFiles();
      const res = await fetch(`${API_URL}/posts/${editingPost._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ...postForm, media })
      });
      const data = await res.json();
      if (res.ok) {
        await fetchPosts();
        setShowPostModal(false);
        setEditingPost(null);
        setPostForm({ title: '', content: '', media: [] });
        setSelectedFiles([]);
      } else {
        throw new Error(data.error || 'Could not update post');
      }
    } catch (error) {
      alert(error.message || 'Error updating post');
    } finally {
      setIsSavingPost(false);
    }
  };

  const handleDeletePost = async (postId) => {
    if (!window.confirm('Delete this post?')) return;
    
    try {
      const res = await fetch(`${API_URL}/posts/${postId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        await fetchPosts();
      }
    } catch (error) {
      alert('Error deleting post');
    }
  };

  const handleUpvote = async (postId) => {
    if (!user) {
      alert('Please sign in to upvote');
      return;
    }
    
    try {
      const res = await fetch(`${API_URL}/posts/${postId}/upvote`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        await fetchPosts();
      }
    } catch (error) {
      alert('Error upvoting post');
    }
  };

  const handleAddComment = async (postId) => {
    const content = (commentInputs[postId] || '').trim();
    if (!content) return;
    
    try {
      const res = await fetch(`${API_URL}/posts/${postId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content })
      });
      
      if (res.ok) {
        await fetchPosts();
        setCommentInputs({ ...commentInputs, [postId]: '' });
      }
    } catch (error) {
      alert('Error adding comment');
    }
  };

  const handleUpdateComment = async () => {
    const content = editingComment?.content.trim();
    if (!content) return;
    try {
      const res = await fetch(`${API_URL}/posts/${editingComment.postId}/comments/${editingComment.commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ content })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update comment');
      await fetchPosts();
      setEditingComment(null);
    } catch (error) {
      alert(error.message || 'Error updating comment');
    }
  };

  const handleDeleteComment = async (postId, commentId) => {
    if (!window.confirm('Delete this comment?')) return;
    
    try {
      const res = await fetch(`${API_URL}/posts/${postId}/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        await fetchPosts();
      }
    } catch (error) {
      alert('Error deleting comment');
    }
  };

  const getSortedPosts = () => {
    const sorted = [...posts];
    if (sortBy === 'top') {
      return sorted.sort((a, b) => b.upvotes.length - a.upvotes.length);
    }
    return sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  };

  const formatTime = (timestamp) => {
    const diff = Date.now() - new Date(timestamp);
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const hasUpvoted = (post) => {
    return user && post.upvotes.includes(user.id);
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <MessageSquare className="logo-icon" size={32} />
            <h1>ForumHub</h1>
          </div>
          <div className="header-actions">
            {user ? (
              <>
                <button
                  onClick={() => {
                    setEditingPost(null);
                    setPostForm({ title: '', content: '', media: [] });
                    setSelectedFiles([]);
                    setShowPostModal(true);
                  }}
                  className="btn-create"
                >
                  <Plus size={20} />
                  Create Post
                </button>
                <span className="username">u/{user.username}</span>
                <button onClick={logout} className="btn-logout">
                  <LogOut size={20} />
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setIsSignUp(false);
                  setShowAuthModal(true);
                }}
                className="btn-signin"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main">
        {/* Sort Options */}
        <div className="sort-buttons">
          <button
            onClick={() => setSortBy('new')}
            className={sortBy === 'new' ? 'sort-btn active' : 'sort-btn'}
          >
            New
          </button>
          <button
            onClick={() => setSortBy('top')}
            className={sortBy === 'top' ? 'sort-btn active' : 'sort-btn'}
          >
            Top
          </button>
        </div>

        {/* Posts List */}
        <div className="posts-list">
          {getSortedPosts().map(post => (
            <div key={post._id} className="post-card">
              <div className="post-content-wrapper">
                {/* Upvote Section */}
                <div className="upvote-section">
                  <button
                    onClick={() => handleUpvote(post._id)}
                    className={hasUpvoted(post) ? 'upvote-btn active' : 'upvote-btn'}
                  >
                    <ThumbsUp size={20} fill={hasUpvoted(post) ? 'currentColor' : 'none'} />
                  </button>
                  <span className="upvote-count">{post.upvotes.length}</span>
                </div>

                {/* Post Content */}
                <div className="post-body">
                  <div className="post-header">
                    <div className="post-info">
                      <div className="post-meta">
                        <span className="author">u/{post.authorUsername}</span>
                        <span>•</span>
                        <span>{formatTime(post.createdAt)}</span>
                      </div>
                      <h2 className="post-title">{post.title}</h2>
                      <p className="post-text">{post.content}</p>
                      {!!post.media?.length && (
                        <div className="post-media-grid">
                          {post.media.map(item => item.contentType?.startsWith('video/') ? (
                            <video key={item.key} className="post-media" src={item.url} controls preload="metadata" />
                          ) : (
                            <img key={item.key} className="post-media" src={item.url} alt={item.originalName || 'Post attachment'} loading="lazy" />
                          ))}
                        </div>
                      )}
                      
                      <button
                        onClick={() => setExpandedComments({...expandedComments, [post._id]: !expandedComments[post._id]})}
                        className="comments-btn"
                      >
                        <MessageSquare size={16} />
                        <span>{post.comments.length} comments</span>
                      </button>
                    </div>

                    {user && user.id === post.author && (
                      <div className="post-actions">
                        <button
                          onClick={() => {
                            setEditingPost(post);
                            setPostForm({ title: post.title, content: post.content, media: post.media || [] });
                            setSelectedFiles([]);
                            setShowPostModal(true);
                          }}
                          className="action-btn edit"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => handleDeletePost(post._id)}
                          className="action-btn delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Comments Section */}
                  {expandedComments[post._id] && (
                    <div className="comments-section">
                      {user && (
                        <div className="comment-input-wrapper">
                          <input
                            type="text"
                            value={commentInputs[post._id] || ''}
                            onChange={(e) => setCommentInputs({...commentInputs, [post._id]: e.target.value})}
                            placeholder="Add a comment..."
                            className="comment-input"
                            onKeyPress={(e) => e.key === 'Enter' && handleAddComment(post._id)}
                          />
                          <button
                            onClick={() => handleAddComment(post._id)}
                            className="comment-send-btn"
                          >
                            <Send size={16} />
                          </button>
                        </div>
                      )}
                      
                      <div className="comments-list">
                        {post.comments.map(comment => (
                          <div key={comment._id} className="comment">
                            <div className="comment-content">
                              <div className="comment-meta">
                                <span className="comment-author">u/{comment.authorUsername}</span>
                                <span>•</span>
                                <span>{formatTime(comment.createdAt)}</span>
                              </div>
                              {editingComment?.commentId === comment._id ? (
                                <div className="comment-edit-form">
                                  <input
                                    value={editingComment.content}
                                    onChange={(event) => setEditingComment({ ...editingComment, content: event.target.value })}
                                    className="comment-input"
                                    maxLength={2000}
                                    autoFocus
                                  />
                                  <button onClick={handleUpdateComment} className="comment-save-btn">Save</button>
                                  <button onClick={() => setEditingComment(null)} className="comment-cancel-btn">Cancel</button>
                                </div>
                              ) : <p className="comment-text">{comment.content}</p>}
                            </div>
                            {user && user.id === comment.author && (
                              <div className="comment-actions">
                                <button
                                  onClick={() => setEditingComment({ postId: post._id, commentId: comment._id, content: comment.content })}
                                  className="comment-edit-btn"
                                  aria-label="Edit comment"
                                  title="Edit comment"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeleteComment(post._id, comment._id)}
                                  className="comment-delete-btn"
                                  aria-label="Delete comment"
                                  title="Delete comment"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {posts.length === 0 && (
            <div className="empty-state">
              <MessageSquare size={48} className="empty-icon" />
              <p>No posts yet. Be the first to create one!</p>
            </div>
          )}
        </div>
      </main>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>{isSignUp ? 'Sign Up' : 'Sign In'}</h2>
              <button onClick={() => setShowAuthModal(false)} className="modal-close">
                <X size={24} />
              </button>
            </div>

            <div className="modal-body">
              {isSignUp && (
                <input
                  type="text"
                  value={authForm.username}
                  onChange={(e) => setAuthForm({...authForm, username: e.target.value})}
                  className="input"
                  placeholder="Username"
                />
              )}
              <input
                type="email"
                value={authForm.email}
                onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                className="input"
                placeholder="Email"
              />
              <input
                type="password"
                value={authForm.password}
                onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                className="input"
                placeholder="Password"
              />
              
              <button onClick={handleAuth} className="btn-primary">
                {isSignUp ? 'Sign Up' : 'Sign In'}
              </button>
              
              <p className="auth-toggle">
                {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
                <button onClick={() => setIsSignUp(!isSignUp)} className="link-btn">
                  {isSignUp ? 'Sign In' : 'Sign Up'}
                </button>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Post Modal */}
      {showPostModal && (
        <div className="modal-overlay">
          <div className="modal modal-large">
            <div className="modal-header">
              <h2>{editingPost ? 'Edit Post' : 'Create New Post'}</h2>
              <button onClick={() => {
                setShowPostModal(false);
                setEditingPost(null);
                setPostForm({ title: '', content: '', media: [] });
                setSelectedFiles([]);
              }} className="modal-close">
                <X size={24} />
              </button>
            </div>

            <div className="modal-body">
              <input
                type="text"
                value={postForm.title}
                onChange={(e) => setPostForm({...postForm, title: e.target.value})}
                className="input"
                placeholder="Enter post title"
                maxLength={200}
              />
              <textarea
                value={postForm.content}
                onChange={(e) => setPostForm({...postForm, content: e.target.value})}
                className="textarea"
                placeholder="What's on your mind?"
                maxLength={10000}
              />

              <label className="media-picker">
                <span>Add photos or videos (up to 5 files, 100 MB each)</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    const remaining = Math.max(0, 5 - (postForm.media?.length || 0));
                    setSelectedFiles(files.slice(0, remaining));
                    if (files.length > remaining) alert(`You can attach up to 5 files per post.`);
                    event.target.value = '';
                  }}
                />
              </label>
              {(postForm.media?.length > 0 || selectedFiles.length > 0) && (
                <div className="attachment-list">
                  {postForm.media.map((item) => (
                    <div className="attachment-item" key={item.key}>
                      <span>{item.originalName}</span>
                      <button type="button" onClick={() => setPostForm({ ...postForm, media: postForm.media.filter((media) => media.key !== item.key) })} aria-label={`Remove ${item.originalName}`}>Remove</button>
                    </div>
                  ))}
                  {selectedFiles.map((file, index) => (
                    <div className="attachment-item pending" key={`${file.name}-${file.lastModified}`}>
                      <span>{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                      <button type="button" onClick={() => setSelectedFiles(selectedFiles.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Remove ${file.name}`}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="modal-footer">
                <button
                  onClick={() => {
                    setShowPostModal(false);
                    setEditingPost(null);
                    setPostForm({ title: '', content: '', media: [] });
                    setSelectedFiles([]);
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={editingPost ? handleUpdatePost : handleCreatePost}
                  className="btn-primary"
                  disabled={isSavingPost}
                >
                  {isSavingPost ? 'Uploading…' : editingPost ? 'Update' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

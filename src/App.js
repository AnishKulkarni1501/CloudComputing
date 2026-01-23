import React, { useState, useEffect } from 'react';
import { MessageSquare, ThumbsUp, Trash2, Edit2, Plus, X, LogOut, Send } from 'lucide-react';
import './App.css';

const API_URL = 'http://localhost:5000/api';

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
  
  const [authForm, setAuthForm] = useState({ username: '', email: '', password: '' });
  const [postForm, setPostForm] = useState({ title: '', content: '' });
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

  const handleCreatePost = async () => {
    if (!postForm.title || !postForm.content) return;
    
    try {
      const res = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(postForm)
      });
      
      if (res.ok) {
        await fetchPosts();
        setShowPostModal(false);
        setPostForm({ title: '', content: '' });
      }
    } catch (error) {
      alert('Error creating post');
    }
  };

  const handleUpdatePost = async () => {
    if (!postForm.title || !postForm.content) return;
    
    try {
      const res = await fetch(`${API_URL}/posts/${editingPost._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(postForm)
      });
      
      if (res.ok) {
        await fetchPosts();
        setShowPostModal(false);
        setEditingPost(null);
        setPostForm({ title: '', content: '' });
      }
    } catch (error) {
      alert('Error updating post');
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
    const content = commentInputs[postId];
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
                    setPostForm({ title: '', content: '' });
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
                            setPostForm({ title: post.title, content: post.content });
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
                              <p className="comment-text">{comment.content}</p>
                            </div>
                            {user && user.id === comment.author && (
                              <button
                                onClick={() => handleDeleteComment(post._id, comment._id)}
                                className="comment-delete-btn"
                              >
                                <Trash2 size={14} />
                              </button>
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
                setPostForm({ title: '', content: '' });
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
              />
              <textarea
                value={postForm.content}
                onChange={(e) => setPostForm({...postForm, content: e.target.value})}
                className="textarea"
                placeholder="What's on your mind?"
              />
              
              <div className="modal-footer">
                <button
                  onClick={() => {
                    setShowPostModal(false);
                    setEditingPost(null);
                    setPostForm({ title: '', content: '' });
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={editingPost ? handleUpdatePost : handleCreatePost}
                  className="btn-primary"
                >
                  {editingPost ? 'Update' : 'Post'}
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
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const app = express();
const server = http.createServer(app);
app.use(cors({
  origin: ['https://syncbeats.netlify.app' , 'http://localhost:3000'],
   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());

//const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production' 
  ? ['your-site.netlify.app', 'another-safe-domain.com'] 
  : ['localhost', '127.0.0.1'];

// Enhanced Security Middleware
app.use(helmet({
  contentSecurityPolicy: false, // {
  crossOriginEmbedderPolicy: false 
 //   directives: {
   //   defaultSrc: ["'self'"],
     // styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      //fontSrc: ["'self'", "fonts.gstatic.com"],
      //scriptSrc: ["'self'", "'unsafe-inline'"],
      //mediaSrc: ["'self'", "blob:", "data:"],
      //connectSrc: ["'self'", "ws:", "wss:"]
  //  }
  //}
}));

app.use(compression());
app.use(cors({
   origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://syncbeats.netlify.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS Error - Origin:', origin);
      callback(null, true); // Allow all for now
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Length', 'Content-Range'] // ✅ ADD exposed headers for audio streaming
}));
//
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
// ✅ ADD THIS ENTIRE BLOCK HERE
app.use('/api/uploads', express.static('/tmp', {
  setHeaders: (res, path, stat) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range, Accept-Ranges');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    // ✅ ENHANCED: Better content type detection
    const ext = path.toLowerCase().split('.').pop();
    const contentTypes = {
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'm4a': 'audio/mp4',
      'flac': 'audio/flac',
      'aac': 'audio/aac'
    };
    
    if (contentTypes[ext]) {
      res.setHeader('Content-Type', contentTypes[ext]);
    }
    
    // ✅ ADD: Additional headers for better audio streaming
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
  }
}));
app.options('/api/uploads/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range, Accept-Ranges');
  res.status(200).end();
});


// Enhanced file upload with better error handling (your existing code continues...)

// Enhanced file upload with better error handling
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = '/tmp' ;
    cb(null, uploadDir);
   
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `track-${uniqueSuffix}-${sanitizedName}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/flac'];
    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed!'), false);
    }
  },
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
});

// Enhanced Room Management
class Room {
  constructor(id, hostId) {
    this.id = id;
    this.hostId = hostId;
    this.users = new Map([[hostId, { id: hostId, joinedAt: Date.now() }]]);
    this.currentTrack = null;
    this.isPlaying = false;
    this.currentTime = 0;
    this.lastUpdateTime = Date.now();
    this.trackStartTime = null;
    this.queue = [];
    this.currentTrackIndex = 0;
    this.volume = 1.0;
    this.createdAt = Date.now();
    //change
    this.repeatMode = 'off'; // 'off', 'one', 'all'
    this.shuffleMode = false;
    this.originalQueue = []; // For shuffle/unshuffle
    this.playedTracks = []; // History
  }
   addToQueue(track) {
    const queueItem = {
      ...track,
      id: Date.now() + Math.random(),
      addedAt: Date.now(),
      addedBy: this.hostId
    };
    
    this.queue.push(queueItem);
    
    // If no current track, set the first one
    if (!this.currentTrack && this.queue.length === 1) {
      this.setCurrentTrack(0);
    }
    
    return queueItem;
  }
  
  removeFromQueue(trackId) {
    const index = this.queue.findIndex(track => track.id === trackId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      
      // Adjust current track index if needed
      if (index < this.currentTrackIndex) {
        this.currentTrackIndex--;
      } else if (index === this.currentTrackIndex) {
        // Current track was removed
        if (this.currentTrackIndex >= this.queue.length) {
          this.currentTrackIndex = 0;
        }
        this.setCurrentTrack(this.currentTrackIndex);
      }
    }
  }
  
  setCurrentTrack(index) {
    if (index >= 0 && index < this.queue.length) {
      this.currentTrackIndex = index;
      this.currentTrack = this.queue[index];
      this.currentTime = 0;
      this.isPlaying = false;
      this.lastUpdateTime = Date.now();
      this.trackStartTime = null;
      return true;
    } else if (this.queue.length === 0) {
      this.currentTrack = null;
      this.currentTrackIndex = 0;
      return false;
    }
    return false;
  }
  
  nextTrack() {
    if (this.queue.length === 0) return false;
    
    // Add current track to played history
    if (this.currentTrack) {
      this.playedTracks.push({...this.currentTrack, playedAt: Date.now()});
      // Keep only last 50 played tracks
      if (this.playedTracks.length > 50) {
        this.playedTracks = this.playedTracks.slice(-50);
      }
    }
    
    let nextIndex;
    
    if (this.repeatMode === 'one') {
      nextIndex = this.currentTrackIndex; // Same track
    } else if (this.repeatMode === 'all') {
      nextIndex = (this.currentTrackIndex + 1) % this.queue.length;
    } else {
      nextIndex = this.currentTrackIndex + 1;
      if (nextIndex >= this.queue.length) {
        return false; // No more tracks
      }
    }
    
    return this.setCurrentTrack(nextIndex);
  }
  
  previousTrack() {
    if (this.queue.length === 0) return false;
    
    let prevIndex;
    
    if (this.currentTrackIndex > 0) {
      prevIndex = this.currentTrackIndex - 1;
    } else if (this.repeatMode === 'all') {
      prevIndex = this.queue.length - 1;
    } else {
      return false;
    }
    
    return this.setCurrentTrack(prevIndex);
  }
  
  clearQueue() {
    this.queue = [];
    this.currentTrack = null;
    this.currentTrackIndex = 0;
    this.currentTime = 0;
    this.isPlaying = false;
    this.originalQueue = [];
  }
  
  shuffleQueue() {
    if (this.queue.length <= 1) return;
    
    // Save original order
    this.originalQueue = [...this.queue];
    
    // Keep current track at the beginning
    const currentTrack = this.queue[this.currentTrackIndex];
    const otherTracks = this.queue.filter((_, index) => index !== this.currentTrackIndex);
    
    // Shuffle other tracks
    for (let i = otherTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
    }
    
    this.queue = [currentTrack, ...otherTracks];
    this.currentTrackIndex = 0;
    this.shuffleMode = true;
  }
  
  unshuffleQueue() {
    if (this.originalQueue.length > 0) {
      const currentTrackId = this.currentTrack?.id;
      this.queue = [...this.originalQueue];
      
      // Find current track position in unshuffled queue
      if (currentTrackId) {
        this.currentTrackIndex = this.queue.findIndex(track => track.id === currentTrackId);
        if (this.currentTrackIndex === -1) this.currentTrackIndex = 0;
      }
      
      this.originalQueue = [];
      this.shuffleMode = false;
    }
  }

  // ===== ENHANCED: Update getRoomState method =====
  getRoomState() {
    return {
      id: this.id,
      hostId: this.hostId,
      users: Array.from(this.users.values()),
      currentTrack: this.currentTrack,
      isPlaying: this.isPlaying,
      currentTime: this.getCurrentTime(),
      userCount: this.users.size,
      volume: this.volume,
      queue: this.queue, // Enhanced
      currentTrackIndex: this.currentTrackIndex,
      repeatMode: this.repeatMode, // New
      shuffleMode: this.shuffleMode, // New
      createdAt: this.createdAt
    };
    //change
  }

  addUser(userId, userInfo = {}) {
    this.users.set(userId, {
      id: userId,
      joinedAt: Date.now(),
      ...userInfo
    });
  }

  removeUser(userId) {
    this.users.delete(userId);
    if (userId === this.hostId && this.users.size > 0) {
      // Transfer host to the user who joined earliest
      const nextHost = Array.from(this.users.values())
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.hostId = nextHost.id;
      return { isEmpty: false, newHostId: this.hostId };
    }
    return { isEmpty: this.users.size === 0, newHostId: null };
  }

  setTrack(track) {
    this.currentTrack = track;
    this.currentTime = 0;
    this.isPlaying = false;
    this.lastUpdateTime = Date.now();
    this.trackStartTime = null;
  }

  play(startTime = null) {
    this.isPlaying = true;
    this.trackStartTime = Date.now();
    if (startTime !== null) {
      this.currentTime = startTime;
    }
    this.lastUpdateTime = Date.now();
  }

  pause() {
    if (this.isPlaying && this.trackStartTime) {
      const elapsed = (Date.now() - this.trackStartTime) / 1000;
      this.currentTime += elapsed;
    }
    this.isPlaying = false;
    this.lastUpdateTime = Date.now();
    this.trackStartTime = null;
  }

  seek(time) {
    this.currentTime = Math.max(0, time);
    this.lastUpdateTime = Date.now();
    if (this.isPlaying) {
      this.trackStartTime = Date.now();
    }
  }

  getCurrentTime() {
    if (!this.isPlaying || !this.trackStartTime) return this.currentTime;
    
    const elapsed = (Date.now() - this.trackStartTime) / 1000;
    return this.currentTime + elapsed;
  }

  getRoomState() {
    return {
      id: this.id,
      hostId: this.hostId,
      users: Array.from(this.users.values()),
      currentTrack: this.currentTrack,
      isPlaying: this.isPlaying,
      currentTime: this.getCurrentTime(),
      userCount: this.users.size,
      volume: this.volume,
      playlist: this.playlist,
      currentTrackIndex: this.currentTrackIndex,
      createdAt: this.createdAt
    };
  }
}

// Global state management
const rooms = new Map();
const userRooms = new Map();
const activeConnections = new Map();

// Utility functions
function generateRoomCode() {
  const adjectives = ['Cool', 'Fire', 'Epic', 'Lit', 'Vibe', 'Wave', 'Beat', 'Flow', 'Chill', 'Wild'];
  const nouns = ['Cats', 'Beats', 'Vibes', 'Squad', 'Crew', 'Gang', 'Wave', 'Zone', 'Party', 'Club'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}${num}`.toUpperCase();
}

function generateUserId() {
  return 'user_' + Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
}

function validateAudioUrl(url) {
  try {
    const validUrl = new URL(url);
    const allowedProtocols = ['http:', 'https:'];
    return allowedProtocols.includes(validUrl.protocol);
  } catch {
    return false;
  }
}

// Enhanced API Routes
app.post('/api/upload', (req, res) => {
  upload.single('audio')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          success: false, 
          error: 'File too large. Maximum size is 100MB.' 
        });
      }
      return res.status(400).json({ 
        success: false, 
        error: `Upload error: ${err.message}` 
      });
    } else if (err) {
      return res.status(400).json({ 
        success: false, 
        error: err.message 
      });
    }

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }

    const fileInfo = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      url:`${req.protocol}://${req.get('host')}/api/uploads/${req.file.filename}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: Date.now()
    };

    console.log(`File uploaded: ${fileInfo.originalName} (${(fileInfo.size / 1024 / 1024).toFixed(2)}MB)`);
    console.log(`File URL: ${fileInfo.url}`); // ✅ ADD LOGGING
    res.json({ success: true, file: fileInfo });
  });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (room) {
    res.json({ success: true, room: room.getRoomState() });
  } else {
    res.status(404).json({ success: false, error: 'Room not found' });
  }
});

// Debug endpoint
app.get('/api/debug/rooms', (req, res) => {
  const roomsInfo = Array.from(rooms.entries()).map(([code, room]) => ({
    code,
    users: room.users.size,
    host: room.hostId,
    hasTrack: !!room.currentTrack,
    isPlaying: room.isPlaying,
    userList: Array.from(room.users.keys())
  }));
  
  res.json({
    activeRooms: roomsInfo,
    totalRooms: rooms.size,
    totalConnections: activeConnections.size,
    userRooms: Object.fromEntries(userRooms)
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    rooms: rooms.size,
    connections: activeConnections.size,
    memory: process.memoryUsage(),
    timestamp: Date.now()
  });
});

// Enhanced WebSocket handling
io.on('connection', (socket) => {
  const userId = generateUserId();
  socket.userId = userId;
  activeConnections.set(socket.id, { userId, connectedAt: Date.now() });

  console.log(`✅ User connected: ${userId} (${socket.id})`);
      socket.emit('connected', { userId: socket.id });

  
  // Send connection confirmation
  socket.emit('connected', { 
    userId, 
    serverTime: Date.now(),
    version: '2.0.0'
  });

  // Enhanced room creation
  socket.on('create-room', (callback) => {
    try {
      if (userRooms.has(userId)) {
        return callback({ 
          success: false, 
          error: 'You are already in a room. Leave current room first.' 
        });
      }

      let roomCode;
      let attempts = 0;
      const maxAttempts = 10;
      
      // Ensure unique room code
      do {
        roomCode = generateRoomCode();
        attempts++;
      } while (rooms.has(roomCode) && attempts < maxAttempts);
      
      if (attempts >= maxAttempts) {
        return callback({ success: false, error: 'Failed to generate unique room code' });
      }

      const room = new Room(roomCode, userId);
      rooms.set(roomCode, room);
      userRooms.set(userId, roomCode);
      
      socket.join(roomCode);
      
      console.log(`🏠 Room created: ${roomCode} by ${userId}`);
      
      callback({ 
        success: true, 
        roomCode, 
        isHost: true,
        roomState: room.getRoomState()
      });
      
    } catch (error) {
      console.error('❌ Create room error:', error);
      callback({ success: false, error: 'Failed to create room' });
    }
  });

  // Enhanced room joining
  socket.on('join-room', (roomCode, callback) => {
    try {
      if (userRooms.has(userId)) {
        return callback({ 
          success: false, 
          error: 'You are already in a room. Leave current room first.' 
        });
      }

      const normalizedRoomCode = roomCode.toUpperCase().trim();
      
      if (!normalizedRoomCode) {
        return callback({ success: false, error: 'Invalid room code' });
      }

      const room = rooms.get(normalizedRoomCode);
      if (!room) {
        console.log(`❌ Room not found: ${normalizedRoomCode}. Available rooms:`, Array.from(rooms.keys()));
        return callback({ success: false, error: 'Room not found' });
      }

      if (room.users.size >= 20) {
        return callback({ success: false, error: 'Room is full (max 20 users)' });
      }

      room.addUser(userId);
      userRooms.set(userId, normalizedRoomCode);
      socket.join(normalizedRoomCode);
      
      console.log(`👋 User ${userId} joined room ${normalizedRoomCode}`);
      
      callback({ 
        success: true, 
        roomCode: normalizedRoomCode,
        isHost: room.hostId === userId,
        roomState: room.getRoomState()
      });
      
      // Notify all users in the room
      socket.to(normalizedRoomCode).emit('user-joined', {
        userId,
        roomState: room.getRoomState(),
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('❌ Join room error:', error);
      callback({ success: false, error: 'Failed to join room' });
    }
  });

  // Leave room
  socket.on('leave-room', (callback) => {
    try {
      const roomCode = userRooms.get(userId);
      if (!roomCode) {
        return callback({ success: false, error: 'Not in any room' });
      }

      const room = rooms.get(roomCode);
      if (room) {
        const result = room.removeUser(userId);
        socket.leave(roomCode);
        
        if (result.isEmpty) {
          rooms.delete(roomCode);
          console.log(`🗑️ Room ${roomCode} deleted (empty)`);
        } else {
          // Notify remaining users
          socket.to(roomCode).emit('user-left', {
            userId,
            roomState: room.getRoomState(),
            timestamp: Date.now()
          });
          
          if (result.newHostId) {
            socket.to(roomCode).emit('host-changed', {
              newHostId: result.newHostId,
              roomState: room.getRoomState(),
              timestamp: Date.now()
            });
          }
        }
      }
      
      userRooms.delete(userId);
      callback({ success: true });
      
    } catch (error) {
      console.error('❌ Leave room error:', error);
      callback({ success: false, error: 'Failed to leave room' });
    }
  });

  // Enhanced track setting with validation
  socket.on('set-track', (trackData, callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (!room) {
        const error = 'Not in a room';
        if (callback) callback({ success: false, error });
        return socket.emit('error', { message: error });
      }
      
      if (room.hostId !== userId) {
        const error = 'Only host can set track';
        if (callback) callback({ success: false, error });
        return socket.emit('error', { message: error });
      }

      // Validate track data
      if (!trackData || !trackData.url || !trackData.title) {
        const error = 'Invalid track data';
        if (callback) callback({ success: false, error });
        return socket.emit('error', { message: error });
      }

      // Validate URL for streaming tracks
      if (trackData.type === 'stream' && !validateAudioUrl(trackData.url)) {
        const error = 'Invalid streaming URL';
        if (callback) callback({ success: false, error });
        return socket.emit('error', { message: error });
      }

      room.setTrack({
        ...trackData,
        setAt: Date.now(),
        setBy: userId
      });
      
      console.log(`🎵 Track set in room ${roomCode}: ${trackData.title}`);
      
      if (callback) callback({ success: true });
      
      // Broadcast to all users in room
      io.to(roomCode).emit('track-changed', {
        track: room.currentTrack,
        roomState: room.getRoomState(),
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('❌ Set track error:', error);
      const errorMsg = 'Failed to set track';
      if (callback) callback({ success: false, error: errorMsg });
      socket.emit('error', { message: errorMsg });
    }
  });

  // Enhanced playback controls with better synchronization
 socket.on('play', (startTime = null, callback) => {
  try {
    const roomCode = userRooms.get(userId);
    const room = rooms.get(roomCode);
    
    if (!room || room.hostId !== userId) {
      const error = 'Only host can control playback';
      if (callback) callback({ success: false, error });
      return socket.emit('error', { message: error });
    }

    if (!room.currentTrack) {
      const error = 'No track loaded';
      if (callback) callback({ success: false, error });
      return socket.emit('error', { message: error });
    }

    // ✅ ENHANCED: More precise timing calculation
    const now = Date.now();
    const targetStartTime = startTime !== null ? startTime : room.getCurrentTime();
    
    // ✅ NEW: Reduced sync delay for better precision (50ms instead of 150ms)
    const syncDelay = 50;
    const syncTime = now + syncDelay;
    
    // ✅ NEW: Store precise timing in room
    room.lastSyncTime = syncTime;
    room.lastSyncPosition = targetStartTime;
    room.play(targetStartTime);
    
    console.log(`▶️ Play command in room ${roomCode} at time ${targetStartTime}s, sync at ${syncTime}`);
    
    if (callback) callback({ success: true });
    
    // ✅ ENHANCED: Include server timestamp for better client sync
    io.to(roomCode).emit('sync-play', {
      startTime: targetStartTime,
      syncTime: syncTime,
      serverTime: now,
      roomState: room.getRoomState(),
      timestamp: now,
      precision: 'high' // ✅ NEW: Flag for high precision mode
    });
    
  } catch (error) {
    console.error('❌ Play error:', error);
    const errorMsg = 'Failed to play track';
    if (callback) callback({ success: false, error: errorMsg });
    socket.emit('error', { message: errorMsg });
  }
});

  socket.on('pause', (callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (!room || room.hostId !== userId) {
        const error = 'Only host can control playback';
        if (callback) callback({ success: false, error });
        return socket.emit('error', { message: error });
      }

      room.pause();
      
      console.log(`⏸️ Pause command in room ${roomCode}`);
      
      if (callback) callback({ success: true });
      
      io.to(roomCode).emit('sync-pause', {
        currentTime: room.getCurrentTime(),
        roomState: room.getRoomState(),
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('❌ Pause error:', error);
      const errorMsg = 'Failed to pause track';
      if (callback) callback({ success: false, error: errorMsg });
      socket.emit('error', { message: errorMsg });
    }
  });

  socket.on('seek', (time, callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (!room || room.hostId !== userId) {
        const error = 'Only host can seek';
        if (callback) callback({ success: false, error });
        return socket.emit('error', { message: error });
      }

      if (typeof time !== 'number' || time < 0) {
        const error = 'Invalid seek time';
        if (callback) callback({ success: false, error });
        return socket.emit('error', { message: error });
      }

      room.seek(time);
      
      console.log(`⏭️ Seek command in room ${roomCode} to time ${time}s`);
      
      if (callback) callback({ success: true });
      
      const syncTime = Date.now() + 100;
      io.to(roomCode).emit('sync-seek', {
        time,
        syncTime,
        isPlaying: room.isPlaying,
        roomState: room.getRoomState(),
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('❌ Seek error:', error);
      const errorMsg = 'Failed to seek track';
      if (callback) callback({ success: false, error: errorMsg });
      socket.emit('error', { message: errorMsg });
    }
  });

  // Get room state
  socket.on('get-room-state', (callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (room) {
        callback({ 
          success: true, 
          roomState: room.getRoomState() 
        });
      } else {
        callback({ 
          success: false, 
          error: 'Not in a room' 
        });
      }
    } catch (error) {
      console.error('❌ Get room state error:', error);
      callback({ 
        success: false, 
        error: 'Failed to get room state' 
      });
    }
  });
  //change
   // Get room state
  socket.on('get-room-state', (callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (room) {
        callback({ 
          success: true, 
          roomState: room.getRoomState() 
        });
      } else {
        callback({ 
          success: false, 
          error: 'Not in a room' 
        });
      }
    } catch (error) {
      console.error('⚠ Get room state error:', error);
      callback({ 
        success: false, 
        error: 'Failed to get room state' 
      });
    }
  });

  // ===== NEW QUEUE MANAGEMENT EVENTS =====
  
  // Add to queue
  socket.on('add-to-queue', (trackData, callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (!room || room.hostId !== userId) {
        const error = 'Only host can manage queue';
        if (callback) callback({ success: false, error });
        return;
      }

      const queueItem = room.addToQueue(trackData);
      
      console.log(`🎼 Track added to queue in room ${roomCode}: ${trackData.title}`);
      
      if (callback) callback({ success: true, queueItem });
      
      io.to(roomCode).emit('queue-updated', {
        queue: room.queue,
        currentTrackIndex: room.currentTrackIndex,
        currentTrack: room.currentTrack,
        roomState: room.getRoomState(),
        action: 'added',
        track: queueItem
      });
      
    } catch (error) {
      console.error('⚠ Add to queue error:', error);
      if (callback) callback({ success: false, error: 'Failed to add to queue' });
    }
  });

  // Remove from queue
  socket.on('remove-from-queue', (trackId, callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (!room || room.hostId !== userId) {
        const error = 'Only host can manage queue';
        if (callback) callback({ success: false, error });
        return;
      }

      room.removeFromQueue(trackId);
      
      if (callback) callback({ success: true });
      
      io.to(roomCode).emit('queue-updated', {
        queue: room.queue,
        currentTrackIndex: room.currentTrackIndex,
        currentTrack: room.currentTrack,
        roomState: room.getRoomState(),
        action: 'removed',
        trackId
      });
      
    } catch (error) {
      console.error('⚠ Remove from queue error:', error);
      if (callback) callback({ success: false, error: 'Failed to remove from queue' });
    }
  });

  // Next track
  socket.on('next-track', (callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (!room || room.hostId !== userId) {
        const error = 'Only host can control playback';
        if (callback) callback({ success: false, error });
        return;
      }

      const hasNext = room.nextTrack();
      
      if (hasNext) {
        console.log(`⏭️ Next track in room ${roomCode}: ${room.currentTrack.title}`);
        
        if (callback) callback({ success: true });
        
        io.to(roomCode).emit('track-changed', {
          track: room.currentTrack,
          queue: room.queue,
          currentTrackIndex: room.currentTrackIndex,
          roomState: room.getRoomState(),
          action: 'next'
        });
      } else {
        if (callback) callback({ success: false, error: 'No more tracks in queue' });
      }
      
    } catch (error) {
      console.error('⚠ Next track error:', error);
      if (callback) callback({ success: false, error: 'Failed to skip track' });
    }
  });

  // Previous track
  socket.on('previous-track', (callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (!room || room.hostId !== userId) {
        const error = 'Only host can control playback';
        if (callback) callback({ success: false, error });
        return;
      }

      const hasPrev = room.previousTrack();
      
      if (hasPrev) {
        console.log(`⏮️ Previous track in room ${roomCode}: ${room.currentTrack.title}`);
        
        if (callback) callback({ success: true });
        
        io.to(roomCode).emit('track-changed', {
          track: room.currentTrack,
          queue: room.queue,
          currentTrackIndex: room.currentTrackIndex,
          roomState: room.getRoomState(),
          action: 'previous'
        });
      } else {
        if (callback) callback({ success: false, error: 'No previous track' });
      }
      
    } catch (error) {
      console.error('⚠ Previous track error:', error);
      if (callback) callback({ success: false, error: 'Failed to go to previous track' });
    }
  });

  // Clear queue
  socket.on('clear-queue', (callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (!room || room.hostId !== userId) {
        const error = 'Only host can manage queue';
        if (callback) callback({ success: false, error });
        return;
      }

      room.clearQueue();
      
      console.log(`🗑️ Queue cleared in room ${roomCode}`);
      
      if (callback) callback({ success: true });
      
      io.to(roomCode).emit('queue-updated', {
        queue: [],
        currentTrackIndex: 0,
        currentTrack: null,
        roomState: room.getRoomState(),
        action: 'cleared'
      });
      
    } catch (error) {
      console.error('⚠ Clear queue error:', error);
      if (callback) callback({ success: false, error: 'Failed to clear queue' });
    }
  });

  // Shuffle queue
  socket.on('shuffle-queue', (callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (!room || room.hostId !== userId) {
        const error = 'Only host can manage queue';
        if (callback) callback({ success: false, error });
        return;
      }

      if (room.shuffleMode) {
        room.unshuffleQueue();
      } else {
        room.shuffleQueue();
      }
      
      console.log(`🔀 Queue ${room.shuffleMode ? 'shuffled' : 'unshuffled'} in room ${roomCode}`);
      
      if (callback) callback({ success: true, shuffleMode: room.shuffleMode });
      
      io.to(roomCode).emit('queue-updated', {
        queue: room.queue,
        currentTrackIndex: room.currentTrackIndex,
        currentTrack: room.currentTrack,
        shuffleMode: room.shuffleMode,
        roomState: room.getRoomState(),
        action: room.shuffleMode ? 'shuffled' : 'unshuffled'
      });
      
    } catch (error) {
      console.error('⚠ Shuffle queue error:', error);
      if (callback) callback({ success: false, error: 'Failed to shuffle queue' });
    }
  });

  // Set repeat mode
  socket.on('set-repeat-mode', (mode, callback) => {
    try {
      const roomCode = userRooms.get(userId);
      const room = rooms.get(roomCode);
      
      if (!room || room.hostId !== userId) {
        const error = 'Only host can manage queue';
        if (callback) callback({ success: false, error });
        return;
      }

      const validModes = ['off', 'one', 'all'];
      if (!validModes.includes(mode)) {
        if (callback) callback({ success: false, error: 'Invalid repeat mode' });
        return;
      }

      room.repeatMode = mode;
      
      console.log(`🔁 Repeat mode set to ${mode} in room ${roomCode}`);
      
      if (callback) callback({ success: true, repeatMode: mode });
      
      io.to(roomCode).emit('repeat-mode-changed', {
        repeatMode: mode,
        roomState: room.getRoomState()
      });
      
    } catch (error) {
      console.error('⚠ Set repeat mode error:', error);
      if (callback) callback({ success: false, error: 'Failed to set repeat mode' });
    }
  });
  // Set current track by index
socket.on('set-current-track', (index, callback) => {
  try {
    const roomCode = userRooms.get(userId);
    const room = rooms.get(roomCode);
    
    if (!room || room.hostId !== userId) {
      const error = 'Only host can change tracks';
      if (callback) callback({ success: false, error });
      return;
    }

    if (room.setCurrentTrack(index)) {
      console.log(`🎵 Current track set to index ${index} in room ${roomCode}`);
      
      if (callback) callback({ success: true });
      
      io.to(roomCode).emit('set-current-track', {
        track: room.currentTrack,
        queue: room.queue,
        currentTrackIndex: room.currentTrackIndex,
        roomState: room.getRoomState()
      });
    } else {
      if (callback) callback({ success: false, error: 'Invalid track index' });
    }
    
  } catch (error) {
    console.error('⚠ Set current track error:', error);
    if (callback) callback({ success: false, error: 'Failed to set current track' });
  }
});

  // ===== END NEW QUEUE MANAGEMENT EVENTS =====
  //change

  // Enhanced disconnect handling
  socket.on('disconnect', (reason) => {
    try {
      console.log(`❌ User disconnected: ${userId} (${reason})`);
      
      activeConnections.delete(socket.id);
      
      const roomCode = userRooms.get(userId);
      if (roomCode) {
        const room = rooms.get(roomCode);
        if (room) {
          const result = room.removeUser(userId);
          
          if (result.isEmpty) {
            rooms.delete(roomCode);
            console.log(`🗑️ Room ${roomCode} deleted (empty after disconnect)`);
          } else {
            // Notify remaining users
            socket.to(roomCode).emit('user-left', {
              userId,
              roomState: room.getRoomState(),
              reason: 'disconnected',
              timestamp: Date.now()
            });
            
            if (result.newHostId) {
              io.to(roomCode).emit('host-changed', {
                newHostId: result.newHostId,
                roomState: room.getRoomState(),
                reason: 'host_disconnected',
                timestamp: Date.now()
              });
            }
          }
        }
        userRooms.delete(userId);
      }
    } catch (error) {
      console.error('❌ Disconnect error:', error);
    }
  });

  // Heartbeat for connection health
  socket.on('ping', (callback) => {
    if (callback) callback({ timestamp: Date.now() });
  });
  socket.on('get-sync-state', (callback) => {
  try {
    const roomCode = userRooms.get(userId);
    const room = rooms.get(roomCode);
    
    if (room) {
      // ✅ NEW: Provide real-time sync state
      const currentTime = room.getCurrentTime();
      const syncState = {
        currentTime,
        isPlaying: room.isPlaying,
        lastSyncTime: room.lastSyncTime || Date.now(),
        serverTime: Date.now(),
        trackDuration: room.currentTrack?.duration || null
      };
      
      callback({ 
        success: true, 
        roomState: {
          ...room.getRoomState(),
          ...syncState
        }
      });
    } else {
      callback({ 
        success: false, 
        error: 'Not in a room' 
      });
    }
  } catch (error) {
    console.error('❌ Get sync state error:', error);
    callback({ 
      success: false, 
      error: 'Failed to get sync state' 
    });
  }
});
});

// Cleanup and maintenance
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  // Clean up old rooms
  for (const [roomCode, room] of rooms.entries()) {
    if (now - room.createdAt > maxAge || room.users.size === 0) {
      rooms.delete(roomCode);
      console.log(`🧹 Cleaned up old/empty room: ${roomCode}`);
    }
  }
  
  // Clean up orphaned user rooms
  for (const [userId, roomCode] of userRooms.entries()) {
    if (!rooms.has(roomCode)) {
      userRooms.delete(userId);
      console.log(`🧹 Cleaned up orphaned user room: ${userId}`);
    }
  }
}, 60000); // Check every minute

// Enhanced error handling
app.use((err, req, res, next) => {
  console.error('❌ Express error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error' 
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🎵 SyncBeats v2.0 server running on http://localhost:${PORT}`);
  console.log(`📁 Upload directory: ${path.join(__dirname, 'public/uploads')}`);
  console.log(`🚀 Ready to sync some beats!`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down SyncBeats server gracefully...');
  
  // Notify all connected clients
  io.emit('server-shutdown', { 
    message: 'Server is shutting down', 
    timestamp: Date.now() 
  });
  
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);

});



































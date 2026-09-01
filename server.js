const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ============ কনফিগারেশন ============
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_change_this';
const PROJECTS_DIR = path.join(__dirname, 'projects');
const USERS_FILE = path.join(__dirname, 'users.json');

// ============ মিডলওয়্যার ============
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// স্ট্যাটিক ফাইল সার্ভ করা
app.use(express.static('public'));
app.use('/projects', express.static(PROJECTS_DIR));

// ============ ফাইল সিস্টেম সেটআপ ============
fs.ensureDirSync(PROJECTS_DIR);
if (!fs.existsSync(USERS_FILE)) {
    fs.writeJsonSync(USERS_FILE, { users: [] });
}

// ============ হেল্পার ফাংশন ============
function getUsers() {
    return fs.readJsonSync(USERS_FILE).users;
}

function saveUsers(users) {
    fs.writeJsonSync(USERS_FILE, { users });
}

function findUser(username) {
    return getUsers().find(u => u.username === username);
}

// ============ JWT ফাংশন ============
function generateToken(username) {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(req, res, next) {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// ============ মুলটার (ফাইল আপলোড) ============
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const siteName = req.body.siteName || 'temp';
        const projectPath = path.join(PROJECTS_DIR, req.user?.username || 'public', siteName);
        fs.ensureDirSync(projectPath);
        if (req.body.isUpdate === 'true') {
            const versionsDir = path.join(projectPath, 'versions');
            fs.ensureDirSync(versionsDir);
        }
        cb(null, projectPath);
    },
    filename: (req, file, cb) => {
        const isUpdate = req.body.isUpdate === 'true';
        if (isUpdate) {
            const siteName = req.body.siteName;
            const projectPath = path.join(PROJECTS_DIR, req.user.username, siteName);
            const versionsDir = path.join(projectPath, 'versions');
            let versionNum = 1;
            if (fs.existsSync(versionsDir)) {
                const files = fs.readdirSync(versionsDir);
                const versions = files.filter(f => f.startsWith('v') && f.endsWith('.html'));
                versionNum = versions.length + 1;
            }
            cb(null, `v${versionNum}.html`);
        } else {
            cb(null, 'index.html');
        }
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/html' || file.originalname.endsWith('.html') || file.originalname.endsWith('.htm')) {
            cb(null, true);
        } else {
            cb(new Error('Only HTML files are allowed'), false);
        }
    }
});

// ============ API রাউট ============

// রুট পাথ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// হেলথ চেক
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// রেজিস্টার
app.post('/register', async (req, res) => {
    try {
        const { username, password, remember } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        if (password.length < 4) {
            return res.status(400).json({ error: 'Password must be at least 4 characters' });
        }
        const users = getUsers();
        if (users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            username,
            password: hashedPassword,
            projects: [],
            createdAt: new Date().toISOString()
        };
        users.push(newUser);
        saveUsers(users);
        const userProjectDir = path.join(PROJECTS_DIR, username);
        fs.ensureDirSync(userProjectDir);
        const token = generateToken(username);
        const maxAge = remember === 'yes' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge
        });
        res.json({ success: true, username });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// লগইন
app.post('/login', async (req, res) => {
    try {
        const { username, password, remember } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        const user = findUser(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = generateToken(username);
        const maxAge = remember === 'yes' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge
        });
        res.json({ success: true, username });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// লগআউট
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// ইউজার তথ্য
app.get('/api/user', verifyToken, async (req, res) => {
    try {
        const user = findUser(req.user.username);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const userProjectDir = path.join(PROJECTS_DIR, user.username);
        let projects = [];
        if (fs.existsSync(userProjectDir)) {
            const items = fs.readdirSync(userProjectDir);
            for (const item of items) {
                const itemPath = path.join(userProjectDir, item);
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                    const indexPath = path.join(itemPath, 'index.html');
                    if (fs.existsSync(indexPath)) {
                        const versionsDir = path.join(itemPath, 'versions');
                        let versions = [];
                        if (fs.existsSync(versionsDir)) {
                            const versionFiles = fs.readdirSync(versionsDir);
                            versions = versionFiles.filter(f => f.endsWith('.html')).map(f => f.replace('.html', ''));
                        }
                        projects.push({ name: item, versions });
                    }
                }
            }
        }
        res.json({ username: user.username, projects });
    } catch (error) {
        console.error('User info error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// আপলোড
app.post('/upload', verifyToken, upload.single('siteFile'), async (req, res) => {
    try {
        const { siteName, isUpdate } = req.body;
        if (!siteName || !req.file) {
            return res.status(400).json({ error: 'Project name and file required' });
        }
        const projectPath = path.join(PROJECTS_DIR, req.user.username, siteName);
        const indexPath = path.join(projectPath, 'index.html');
        if (isUpdate !== 'true') {
            if (fs.existsSync(projectPath) && fs.existsSync(indexPath)) {
                return res.status(400).json({ error: 'Project already exists. Use update instead.' });
            }
            const versionsDir = path.join(projectPath, 'versions');
            fs.ensureDirSync(versionsDir);
        }
        res.json({
            success: true,
            message: isUpdate === 'true' ? 'Project updated successfully' : 'Project deployed successfully',
            siteUrl: `/${req.user.username}/${siteName}`
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// ডিলিট
app.post('/api/delete', verifyToken, async (req, res) => {
    try {
        const { siteName } = req.body;
        if (!siteName) {
            return res.status(400).json({ error: 'Project name required' });
        }
        const projectPath = path.join(PROJECTS_DIR, req.user.username, siteName);
        if (!fs.existsSync(projectPath)) {
            return res.status(404).json({ error: 'Project not found' });
        }
        await fs.remove(projectPath);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Delete failed' });
    }
});

// রিনেম
app.post('/api/rename-project', verifyToken, async (req, res) => {
    try {
        const { oldName, newName } = req.body;
        if (!oldName || !newName) {
            return res.status(400).json({ error: 'Old and new names required' });
        }
        if (oldName === newName) {
            return res.json({ success: true, message: 'No change needed' });
        }
        const oldPath = path.join(PROJECTS_DIR, req.user.username, oldName);
        const newPath = path.join(PROJECTS_DIR, req.user.username, newName);
        if (!fs.existsSync(oldPath)) {
            return res.status(404).json({ error: 'Project not found' });
        }
        if (fs.existsSync(newPath)) {
            return res.status(400).json({ error: 'A project with this name already exists' });
        }
        await fs.move(oldPath, newPath);
        res.json({ success: true });
    } catch (error) {
        console.error('Rename error:', error);
        res.status(500).json({ error: 'Rename failed' });
    }
});

// ভার্সন ডাউনলোড
app.get('/api/download-version', verifyToken, async (req, res) => {
    try {
        const { project, v } = req.query;
        if (!project || !v) {
            return res.status(400).json({ error: 'Project name and version required' });
        }
        const filePath = path.join(PROJECTS_DIR, req.user.username, project, 'versions', `${v}.html`);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Version not found' });
        }
        res.download(filePath, `${project}-${v}.html`);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

// প্রজেক্ট ভিউ
app.get('/:username/:projectName', (req, res) => {
    const { username, projectName } = req.params;
    const indexPath = path.join(PROJECTS_DIR, username, projectName, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Project not found');
    }
});

// SPA রাউট - সব অজানা রিকুয়েস্ট index.html পাঠান
app.get('*', (req, res) => {
    // API রিকুয়েস্ট চেক করুন
    if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/login' || req.path === '/register' || req.path === '/logout') {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ এরর হ্যান্ডলিং ============
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'FILE_TOO_LARGE') {
            return res.status(400).json({ error: 'File too large. Max 10MB.' });
        }
        return res.status(400).json({ error: err.message });
    }
    console.error('Global error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ============ সার্ভার স্টার্ট ============
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Projects directory: ${PROJECTS_DIR}`);
    console.log(`👥 Users file: ${USERS_FILE}`);
    console.log(`🔐 JWT Secret: ${JWT_SECRET ? '✅ Set' : '❌ Not set'}`);
    console.log(`🌐 Serving static files from: ${path.join(__dirname, 'public')}`);
});

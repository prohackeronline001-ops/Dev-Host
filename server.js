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
    origin: ['http://localhost:3000', 'https://your-frontend.com', 'http://127.0.0.1:5500'],
    credentials: true
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// স্ট্যাটিক ফাইল সার্ভ করা (প্রজেক্ট ফাইল)
app.use('/projects', express.static(PROJECTS_DIR));

// ============ ফাইল সিস্টেম সেটআপ ============
fs.ensureDirSync(PROJECTS_DIR);

// ইউজার ডাটাবেস সেটআপ
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
        const projectPath = path.join(PROJECTS_DIR, siteName);
        fs.ensureDirSync(projectPath);
        
        // যদি আপডেট হয়, ভার্সন ফোল্ডার তৈরি করুন
        if (req.body.isUpdate === 'true') {
            const versionsDir = path.join(projectPath, 'versions');
            fs.ensureDirSync(versionsDir);
        }
        
        cb(null, projectPath);
    },
    filename: (req, file, cb) => {
        const isUpdate = req.body.isUpdate === 'true';
        if (isUpdate) {
            // ভার্সন ফাইল নাম
            const siteName = req.body.siteName;
            const projectPath = path.join(PROJECTS_DIR, siteName);
            const versionsDir = path.join(projectPath, 'versions');
            
            // বর্তমান ভার্সন সংখ্যা বের করুন
            let versionNum = 1;
            if (fs.existsSync(versionsDir)) {
                const files = fs.readdirSync(versionsDir);
                const versions = files.filter(f => f.startsWith('v') && f.endsWith('.html'));
                versionNum = versions.length + 1;
            }
            cb(null, `v${versionNum}.html`);
        } else {
            // নতুন প্রজেক্ট: index.html
            cb(null, 'index.html');
        }
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/html' || file.originalname.endsWith('.html') || file.originalname.endsWith('.htm')) {
            cb(null, true);
        } else {
            cb(new Error('Only HTML files are allowed'), false);
        }
    }
});

// ============ এপিআই এন্ডপয়েন্ট ============

// 1. রেজিস্টার
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
        
        // ইউজারের জন্য প্রজেক্ট ফোল্ডার তৈরি করুন
        const userProjectDir = path.join(PROJECTS_DIR, username);
        fs.ensureDirSync(userProjectDir);
        
        // টোকেন জেনারেট করুন
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

// 2. লগইন
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

// 3. লগআউট
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// 4. ইউজার তথ্য (প্রজেক্ট সহ)
app.get('/api/user', verifyToken, async (req, res) => {
    try {
        const user = findUser(req.user.username);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // প্রজেক্ট ফোল্ডার থেকে প্রকৃত প্রজেক্ট লিস্ট পড়ুন
        const userProjectDir = path.join(PROJECTS_DIR, user.username);
        let projects = [];
        
        if (fs.existsSync(userProjectDir)) {
            const items = fs.readdirSync(userProjectDir);
            for (const item of items) {
                const itemPath = path.join(userProjectDir, item);
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                    // প্রজেক্টের ভিতরে index.html আছে কিনা চেক করুন
                    const indexPath = path.join(itemPath, 'index.html');
                    if (fs.existsSync(indexPath)) {
                        // ভার্সন লিস্ট
                        const versionsDir = path.join(itemPath, 'versions');
                        let versions = [];
                        if (fs.existsSync(versionsDir)) {
                            const versionFiles = fs.readdirSync(versionsDir);
                            versions = versionFiles
                                .filter(f => f.endsWith('.html'))
                                .map(f => f.replace('.html', ''));
                        }
                        projects.push({
                            name: item,
                            versions
                        });
                    }
                }
            }
        }
        
        res.json({
            username: user.username,
            projects
        });
    } catch (error) {
        console.error('User info error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 5. আপলোড (নতুন প্রজেক্ট বা আপডেট)
app.post('/upload', verifyToken, upload.single('siteFile'), async (req, res) => {
    try {
        const { siteName, isUpdate, enableSecurity } = req.body;
        
        if (!siteName || !req.file) {
            return res.status(400).json({ error: 'Project name and file required' });
        }
        
        // প্রজেক্ট পাথ
        const projectPath = path.join(PROJECTS_DIR, req.user.username, siteName);
        const indexPath = path.join(projectPath, 'index.html');
        
        // নতুন প্রজেক্ট
        if (isUpdate !== 'true') {
            // চেক করুন প্রজেক্ট ইতিমধ্যে আছে কিনা
            if (fs.existsSync(projectPath) && fs.existsSync(indexPath)) {
                return res.status(400).json({ error: 'Project already exists. Use update instead.' });
            }
            
            // ফাইল ইতিমধ্যে multer দ্বারা সংরক্ষিত হয়েছে
            // এখন ভার্সন ফোল্ডার তৈরি করুন
            const versionsDir = path.join(projectPath, 'versions');
            fs.ensureDirSync(versionsDir);
            
            // বর্তমান ফাইলকে v1.html হিসেবে কপি করুন
            const currentFilePath = path.join(projectPath, 'index.html');
            const v1Path = path.join(versionsDir, 'v1.html');
            if (fs.existsSync(currentFilePath)) {
                fs.copyFileSync(currentFilePath, v1Path);
            }
            
        } else {
            // আপডেট: ভার্সন ফাইল ইতিমধ্যে multer দ্বারা সংরক্ষিত হয়েছে (vN.html)
            // আর কিছু করার প্রয়োজন নেই
        }
        
        res.json({ 
            success: true, 
            message: isUpdate === 'true' ? 'Project updated successfully' : 'Project deployed successfully',
            siteUrl: `${req.protocol}://${req.get('host')}/projects/${req.user.username}/${siteName}`
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// 6. প্রজেক্ট ডিলিট
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
        
        // রিকার্সিভলি ডিলিট
        await fs.remove(projectPath);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Delete failed' });
    }
});

// 7. প্রজেক্ট রিনেম
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

// 8. ভার্সন ডাউনলোড
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

// 9. প্রজেক্ট দেখার জন্য রুট (রিডাইরেক্ট)
app.get('/:username/:projectName', (req, res) => {
    const { username, projectName } = req.params;
    const indexPath = path.join(PROJECTS_DIR, username, projectName, 'index.html');
    
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Project not found');
    }
});

// ============ হেলথ চেক ============
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
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
});

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ============ গিটহাব কনফিগারেশন ============
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_API = 'https://api.github.com/repos';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// ============ কনফিগারেশন ============
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_change_this';

// ============ লোকাল স্টোরেজ ডিরেক্টরি ============
const LOCAL_STORAGE_DIR = path.join(__dirname, 'local-storage');
fs.ensureDirSync(LOCAL_STORAGE_DIR);
const USERS_DIR = path.join(LOCAL_STORAGE_DIR, 'users');
fs.ensureDirSync(USERS_DIR);

// ============ গিটহাব স্টোরেজ ক্লাস ============
class GitHubStorage {
    constructor() {
        this.useLocalStorage = true; // Default to local storage
        
        if (GITHUB_TOKEN && GITHUB_REPO) {
            this.headers = {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            };
            this.repoPath = `${GITHUB_API}/${GITHUB_REPO}`;
            this.useLocalStorage = false;
            console.log('✅ GitHub storage configured');
        } else {
            console.log('⚠️ Using local storage fallback');
        }
    }

    async saveUserData(username, data) {
        try {
            // Always save locally first
            const userFile = path.join(USERS_DIR, `${username}.json`);
            fs.writeJsonSync(userFile, data);
            console.log(`✅ User saved locally: ${username}`);

            // Try GitHub if configured
            if (!this.useLocalStorage) {
                const filePath = `users/${username}.json`;
                const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
                
                let sha = null;
                try {
                    const fileCheck = await axios.get(`${this.repoPath}/contents/${filePath}`, {
                        headers: this.headers
                    });
                    sha = fileCheck.data.sha;
                } catch (error) {
                    if (error.response?.status !== 404) throw error;
                }

                const payload = {
                    message: `Update user data for ${username}`,
                    content: content,
                    branch: GITHUB_BRANCH
                };
                
                if (sha) {
                    payload.sha = sha;
                    await axios.put(`${this.repoPath}/contents/${filePath}`, payload, {
                        headers: this.headers
                    });
                } else {
                    await axios.put(`${this.repoPath}/contents/${filePath}`, payload, {
                        headers: this.headers
                    });
                }
                console.log(`✅ User saved to GitHub: ${username}`);
            }
            
            return true;
        } catch (error) {
            console.error('❌ Save user error:', error.message);
            // User already saved locally, so return true
            return true;
        }
    }

    async getUserData(username) {
        try {
            // Check local storage first
            const userFile = path.join(USERS_DIR, `${username}.json`);
            if (fs.existsSync(userFile)) {
                const data = fs.readJsonSync(userFile);
                console.log(`✅ User found locally: ${username}`);
                return data;
            }

            // Try GitHub if configured
            if (!this.useLocalStorage) {
                try {
                    const filePath = `users/${username}.json`;
                    const response = await axios.get(`${this.repoPath}/contents/${filePath}`, {
                        headers: this.headers
                    });
                    
                    const content = Buffer.from(response.data.content, 'base64').toString('utf8');
                    const data = JSON.parse(content);
                    
                    // Save locally for future use
                    fs.writeJsonSync(userFile, data);
                    console.log(`✅ User found on GitHub: ${username}`);
                    return data;
                } catch (error) {
                    if (error.response?.status === 404) {
                        console.log(`❌ User not found: ${username}`);
                        return null;
                    }
                    throw error;
                }
            }
            
            console.log(`❌ User not found: ${username}`);
            return null;
        } catch (error) {
            console.error('❌ Get user error:', error.message);
            return null;
        }
    }

    async getAllUsers() {
        try {
            // Get from local storage
            const users = [];
            if (fs.existsSync(USERS_DIR)) {
                const files = fs.readdirSync(USERS_DIR);
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        const data = fs.readJsonSync(path.join(USERS_DIR, file));
                        users.push(data);
                    }
                }
            }
            
            if (users.length > 0) {
                console.log(`✅ Found ${users.length} users locally`);
                return users;
            }

            // Try GitHub if configured
            if (!this.useLocalStorage) {
                try {
                    const response = await axios.get(`${this.repoPath}/contents/users`, {
                        headers: this.headers
                    });
                    
                    for (const file of response.data) {
                        if (file.name.endsWith('.json')) {
                            const userData = await this.getUserData(file.name.replace('.json', ''));
                            if (userData) {
                                users.push(userData);
                            }
                        }
                    }
                    console.log(`✅ Found ${users.length} users on GitHub`);
                    return users;
                } catch (error) {
                    if (error.response?.status === 404) {
                        return [];
                    }
                    throw error;
                }
            }
            
            return users;
        } catch (error) {
            console.error('❌ Get all users error:', error.message);
            return [];
        }
    }

    // Other methods with local storage fallback...
    async saveProjectData(username, projectName, data) {
        try {
            const projectDir = path.join(LOCAL_STORAGE_DIR, 'users', username, 'projects', projectName);
            fs.ensureDirSync(projectDir);
            fs.writeJsonSync(path.join(projectDir, 'data.json'), data);
            return true;
        } catch (error) {
            console.error('Save project error:', error);
            return false;
        }
    }

    async getProjectData(username, projectName) {
        try {
            const dataFile = path.join(LOCAL_STORAGE_DIR, 'users', username, 'projects', projectName, 'data.json');
            if (fs.existsSync(dataFile)) {
                return fs.readJsonSync(dataFile);
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async saveFile(username, projectName, fileName, content) {
        try {
            const projectDir = path.join(LOCAL_STORAGE_DIR, 'users', username, 'projects', projectName);
            fs.ensureDirSync(projectDir);
            fs.writeFileSync(path.join(projectDir, fileName), content);
            return true;
        } catch (error) {
            console.error('Save file error:', error);
            return false;
        }
    }

    async getFile(username, projectName, fileName) {
        try {
            const filePath = path.join(LOCAL_STORAGE_DIR, 'users', username, 'projects', projectName, fileName);
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf8');
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async deleteProject(username, projectName) {
        try {
            const projectDir = path.join(LOCAL_STORAGE_DIR, 'users', username, 'projects', projectName);
            if (fs.existsSync(projectDir)) {
                fs.removeSync(projectDir);
            }
            return true;
        } catch (error) {
            return false;
        }
    }
}

const githubStorage = new GitHubStorage();

// ============ মিডলওয়্যার ============
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ============ হেল্পার ফাংশন ============
async function findUser(username) {
    try {
        return await githubStorage.getUserData(username);
    } catch (error) {
        return null;
    }
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

// ============ মুলটার ============
const storage = multer.memoryStorage();
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        storage: githubStorage.useLocalStorage ? 'Local' : 'GitHub',
        usersCount: fs.existsSync(USERS_DIR) ? fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json')).length : 0
    });
});

// ============ রেজিস্টার ============
app.post('/register', async (req, res) => {
    try {
        console.log('📝 Register request received:', req.body);
        const { username, password, remember } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        if (password.length < 4) {
            return res.status(400).json({ error: 'Password must be at least 4 characters' });
        }
        
        // Check if user exists
        const existingUser = await findUser(username);
        console.log('🔍 Existing user check:', existingUser ? 'Found' : 'Not found');
        
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        // Hash password and save
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            username,
            password: hashedPassword,
            projects: [],
            createdAt: new Date().toISOString()
        };
        
        await githubStorage.saveUserData(username, newUser);
        console.log('✅ User registered successfully:', username);
        
        // Generate token
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
        console.error('❌ Register error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// ============ লগইন ============
app.post('/login', async (req, res) => {
    try {
        console.log('📝 Login request received:', req.body);
        const { username, password, remember } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        // Find user
        const user = await findUser(username);
        console.log('🔍 User found:', user ? 'Yes' : 'No');
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Check password
        console.log('🔐 Checking password...');
        const validPassword = await bcrypt.compare(password, user.password);
        console.log('🔐 Password valid:', validPassword);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Generate token
        const token = generateToken(username);
        const maxAge = remember === 'yes' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge
        });
        
        console.log('✅ Login successful:', username);
        res.json({ success: true, username });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// ============ লগআউট ============
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// ============ ইউজার তথ্য ============
app.get('/api/user', verifyToken, async (req, res) => {
    try {
        const user = await findUser(req.user.username);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        let projects = [];
        if (user.projects) {
            for (const project of user.projects) {
                const projectData = await githubStorage.getProjectData(user.username, project);
                if (projectData) {
                    projects.push({
                        name: project,
                        versions: projectData.versions || []
                    });
                }
            }
        }
        
        res.json({ username: user.username, projects });
    } catch (error) {
        console.error('User info error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// ============ আপলোড ============
app.post('/upload', verifyToken, upload.single('siteFile'), async (req, res) => {
    try {
        const { siteName, isUpdate } = req.body;
        if (!siteName || !req.file) {
            return res.status(400).json({ error: 'Project name and file required' });
        }
        
        const user = await findUser(req.user.username);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const projectExists = user.projects && user.projects.includes(siteName);
        
        if (isUpdate !== 'true') {
            if (projectExists) {
                return res.status(400).json({ error: 'Project already exists. Use update instead.' });
            }
            
            const projectData = {
                name: siteName,
                versions: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            await githubStorage.saveProjectData(req.user.username, siteName, projectData);
            await githubStorage.saveFile(req.user.username, siteName, 'index.html', req.file.buffer.toString('utf8'));
            
            if (!user.projects) {
                user.projects = [];
            }
            user.projects.push(siteName);
            await githubStorage.saveUserData(req.user.username, user);
            
            res.json({
                success: true,
                message: 'Project deployed successfully',
                siteUrl: `/${req.user.username}/${siteName}`
            });
        } else {
            if (!projectExists) {
                return res.status(404).json({ error: 'Project not found' });
            }
            
            const projectData = await githubStorage.getProjectData(req.user.username, siteName);
            if (!projectData) {
                return res.status(404).json({ error: 'Project data not found' });
            }
            
            let versionNum = 1;
            if (projectData.versions && projectData.versions.length > 0) {
                versionNum = projectData.versions.length + 1;
            }
            const versionName = `v${versionNum}`;
            
            await githubStorage.saveFile(req.user.username, siteName, `${versionName}.html`, req.file.buffer.toString('utf8'));
            
            if (!projectData.versions) {
                projectData.versions = [];
            }
            projectData.versions.push(versionName);
            projectData.updatedAt = new Date().toISOString();
            
            await githubStorage.saveProjectData(req.user.username, siteName, projectData);
            await githubStorage.saveFile(req.user.username, siteName, 'index.html', req.file.buffer.toString('utf8'));
            
            res.json({
                success: true,
                message: 'Project updated successfully',
                siteUrl: `/${req.user.username}/${siteName}`
            });
        }
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed: ' + error.message });
    }
});

// ============ ডিলিট ============
app.post('/api/delete', verifyToken, async (req, res) => {
    try {
        const { siteName } = req.body;
        if (!siteName) {
            return res.status(400).json({ error: 'Project name required' });
        }
        
        await githubStorage.deleteProject(req.user.username, siteName);
        
        const user = await findUser(req.user.username);
        if (user && user.projects) {
            user.projects = user.projects.filter(p => p !== siteName);
            await githubStorage.saveUserData(req.user.username, user);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Delete failed: ' + error.message });
    }
});

// ============ রিনেম ============
app.post('/api/rename-project', verifyToken, async (req, res) => {
    try {
        const { oldName, newName } = req.body;
        if (!oldName || !newName) {
            return res.status(400).json({ error: 'Old and new names required' });
        }
        if (oldName === newName) {
            return res.json({ success: true, message: 'No change needed' });
        }
        
        const user = await findUser(req.user.username);
        if (!user || !user.projects || !user.projects.includes(oldName)) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        if (user.projects.includes(newName)) {
            return res.status(400).json({ error: 'A project with this name already exists' });
        }
        
        const projectData = await githubStorage.getProjectData(req.user.username, oldName);
        if (!projectData) {
            return res.status(404).json({ error: 'Project data not found' });
        }
        
        const files = ['index.html', ...(projectData.versions || []).map(v => `${v}.html`)];
        
        for (const file of files) {
            const content = await githubStorage.getFile(req.user.username, oldName, file);
            if (content) {
                await githubStorage.saveFile(req.user.username, newName, file, content);
            }
        }
        
        projectData.name = newName;
        await githubStorage.saveProjectData(req.user.username, newName, projectData);
        await githubStorage.deleteProject(req.user.username, oldName);
        
        user.projects = user.projects.map(p => p === oldName ? newName : p);
        await githubStorage.saveUserData(req.user.username, user);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Rename error:', error);
        res.status(500).json({ error: 'Rename failed: ' + error.message });
    }
});

// ============ ভার্সন ডাউনলোড ============
app.get('/api/download-version', verifyToken, async (req, res) => {
    try {
        const { project, v } = req.query;
        if (!project || !v) {
            return res.status(400).json({ error: 'Project name and version required' });
        }
        
        const content = await githubStorage.getFile(req.user.username, project, `${v}.html`);
        if (!content) {
            return res.status(404).json({ error: 'Version not found' });
        }
        
        res.setHeader('Content-Disposition', `attachment; filename="${project}-${v}.html"`);
        res.setHeader('Content-Type', 'text/html');
        res.send(content);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Download failed: ' + error.message });
    }
});

// ============ প্রজেক্ট ভিউ ============
app.get('/:username/:projectName', async (req, res) => {
    const { username, projectName } = req.params;
    
    if (!username || !projectName) {
        return res.status(400).send('Invalid project path');
    }
    
    const safeUsername = username.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeProjectName = projectName.replace(/[^a-zA-Z0-9_-]/g, '');
    
    if (safeUsername !== username || safeProjectName !== projectName) {
        return res.status(400).send('Invalid characters in path');
    }
    
    try {
        const content = await githubStorage.getFile(safeUsername, safeProjectName, 'index.html');
        if (content) {
            res.send(content);
        } else {
            res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head><title>404 - Project Not Found</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>📁 Project Not Found</h1>
                    <p>The project "<strong>${safeProjectName}</strong>" for user "<strong>${safeUsername}</strong>" does not exist.</p>
                    <p><a href="/" style="color: #3b82f6; text-decoration: none;">← Go to Home</a></p>
                </body>
                </html>
            `);
        }
    } catch (error) {
        console.error('Project view error:', error);
        res.status(500).send('Error loading project');
    }
});

// ============ SPA রাউট ============
app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || 
        req.path === '/health' || 
        req.path === '/login' || 
        req.path === '/register' || 
        req.path === '/logout') {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    
    if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|webp|json|xml|txt)$/)) {
        return res.status(404).send('File not found');
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
    res.status(500).json({ error: 'Internal server error: ' + err.message });
});

// ============ সার্ভার স্টার্ট ============
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔐 JWT Secret: ${JWT_SECRET ? '✅ Set' : '❌ Not set'}`);
    console.log(`💾 Storage: ${githubStorage.useLocalStorage ? 'Local' : 'GitHub'}`);
    console.log(`📁 Local storage: ${LOCAL_STORAGE_DIR}`);
    console.log(`👥 Users directory: ${USERS_DIR}`);
});

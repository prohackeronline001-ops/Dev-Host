// githubStorage.js
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_API = 'https://api.github.com/repos';

class GitHubStorage {
    constructor() {
        this.headers = {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };
        this.repoPath = `${GITHUB_API}/${GITHUB_REPO}`;
    }

    async saveUserData(username, data) {
        try {
            const filePath = `users/${username}.json`;
            const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
            
            // Check if file exists
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
                branch: process.env.GITHUB_BRANCH || 'main'
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
            
            return true;
        } catch (error) {
            console.error('GitHub save error:', error);
            throw error;
        }
    }

    async getUserData(username) {
        try {
            const filePath = `users/${username}.json`;
            const response = await axios.get(`${this.repoPath}/contents/${filePath}`, {
                headers: this.headers
            });
            
            const content = Buffer.from(response.data.content, 'base64').toString('utf8');
            return JSON.parse(content);
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async getAllUsers() {
        try {
            const response = await axios.get(`${this.repoPath}/contents/users`, {
                headers: this.headers
            });
            
            const users = [];
            for (const file of response.data) {
                if (file.name.endsWith('.json')) {
                    const userData = await this.getUserData(file.name.replace('.json', ''));
                    if (userData) {
                        users.push(userData);
                    }
                }
            }
            return users;
        } catch (error) {
            console.error('Error getting all users:', error);
            return [];
        }
    }

    async saveProjectData(username, projectName, data) {
        try {
            const filePath = `users/${username}/projects/${projectName}/data.json`;
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
                message: `Update project ${projectName} for ${username}`,
                content: content,
                branch: process.env.GITHUB_BRANCH || 'main'
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
            
            return true;
        } catch (error) {
            console.error('GitHub save project error:', error);
            throw error;
        }
    }

    async getProjectData(username, projectName) {
        try {
            const filePath = `users/${username}/projects/${projectName}/data.json`;
            const response = await axios.get(`${this.repoPath}/contents/${filePath}`, {
                headers: this.headers
            });
            
            const content = Buffer.from(response.data.content, 'base64').toString('utf8');
            return JSON.parse(content);
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async saveFile(username, projectName, fileName, content) {
        try {
            const filePath = `users/${username}/projects/${projectName}/${fileName}`;
            const base64Content = Buffer.from(content).toString('base64');
            
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
                message: `Add file ${fileName} to ${projectName}`,
                content: base64Content,
                branch: process.env.GITHUB_BRANCH || 'main'
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
            
            return true;
        } catch (error) {
            console.error('GitHub save file error:', error);
            throw error;
        }
    }

    async getFile(username, projectName, fileName) {
        try {
            const filePath = `users/${username}/projects/${projectName}/${fileName}`;
            const response = await axios.get(`${this.repoPath}/contents/${filePath}`, {
                headers: this.headers
            });
            
            return Buffer.from(response.data.content, 'base64').toString('utf8');
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async deleteFile(username, projectName, fileName) {
        try {
            const filePath = `users/${username}/projects/${projectName}/${fileName}`;
            const fileCheck = await axios.get(`${this.repoPath}/contents/${filePath}`, {
                headers: this.headers
            });
            
            const payload = {
                message: `Delete file ${fileName} from ${projectName}`,
                sha: fileCheck.data.sha,
                branch: process.env.GITHUB_BRANCH || 'main'
            };
            
            await axios.delete(`${this.repoPath}/contents/${filePath}`, {
                headers: this.headers,
                data: payload
            });
            
            return true;
        } catch (error) {
            console.error('GitHub delete file error:', error);
            throw error;
        }
    }

    async deleteProject(username, projectName) {
        try {
            const folderPath = `users/${username}/projects/${projectName}`;
            const response = await axios.get(`${this.repoPath}/contents/${folderPath}`, {
                headers: this.headers
            });
            
            for (const file of response.data) {
                await this.deleteFile(username, projectName, file.name);
            }
            
            return true;
        } catch (error) {
            console.error('GitHub delete project error:', error);
            throw error;
        }
    }
}

module.exports = new GitHubStorage();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.sqlite');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const BIN_DIR = path.join(__dirname, 'bin');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicializa la base de datos
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                artist TEXT,
                duration INTEGER,
                thumbnail TEXT,
                file_path TEXT NOT NULL UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS playlist_songs (
                playlist_id INTEGER,
                song_id INTEGER,
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                PRIMARY KEY (playlist_id, song_id)
            )
        `);
        console.log("Database tables created or already exist.");
    });
}

// Función para limpiar la URL de YouTube
const cleanUrl = (url) => {
    const urlObj = new URL(url);
    urlObj.searchParams.delete('list');
    urlObj.searchParams.delete('index');
    urlObj.searchParams.delete('start_radio');
    urlObj.searchParams.delete('t');
    return urlObj.toString();
};

// ENDPOINTS DE CANCIONES

// POST /api/songs/download
app.post('/api/songs/download', (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ success: false, message: 'URL is required' });
    }

    const cleanVideoUrl = cleanUrl(url);
    const ytDlpPath = path.join(BIN_DIR, 'yt-dlp.exe');
    const ffmpegPath = BIN_DIR;
    const outputTemplate = path.join(DOWNLOADS_DIR, '%(id)s.%(ext)s');

    const command = `"${ytDlpPath}" --extract-audio --audio-format mp3 --audio-quality 0 --ffmpeg-location "${ffmpegPath}" -o "${outputTemplate}" --print-json "${cleanVideoUrl}"`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).json({ success: false, message: 'Failed to download audio.', error: stderr });
        }

        try {
            const videoJson = JSON.parse(stdout);
            const filePath = path.join(DOWNLOADS_DIR, `${videoJson.id}.mp3`);
            
            const songData = {
                title: videoJson.title,
                artist: videoJson.uploader || 'Unknown Artist',
                duration: Math.round(videoJson.duration),
                thumbnail: videoJson.thumbnail,
                file_path: path.relative(__dirname, filePath).replace(/\\/g, '/')
            };
            
            const query = `INSERT INTO songs (title, artist, duration, thumbnail, file_path) VALUES (?, ?, ?, ?, ?)`;
            db.run(query, [songData.title, songData.artist, songData.duration, songData.thumbnail, songData.file_path], function (err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                         return res.status(200).json({ success: true, message: 'Song already exists.', data: songData });
                    }
                    return res.status(500).json({ success: false, message: 'Failed to save song to database.', error: err.message });
                }
                res.status(201).json({ success: true, message: 'Download complete!', data: { id: this.lastID, ...songData } });
            });

        } catch (parseError) {
            console.error('Error parsing yt-dlp output:', parseError);
            res.status(500).json({ success: false, message: 'Could not parse video information.' });
        }
    });
});


// GET /api/songs
app.get('/api/songs', (req, res) => {
    db.all("SELECT * FROM songs ORDER BY created_at DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ data: rows });
    });
});

// GET /api/songs/:id/stream
app.get('/api/songs/:id/stream', (req, res) => {
    const { id } = req.params;
    db.get("SELECT file_path FROM songs WHERE id = ?", [id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ message: 'Song not found' });
        }

        const filePath = path.join(__dirname, row.file_path);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: 'File not found' });
        }
        
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'audio/mpeg',
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': 'audio/mpeg',
            };
            res.writeHead(200, head);
            fs.createReadStream(filePath).pipe(res);
        }
    });
});

// ENDPOINTS DE PLAYLISTS

// POST /api/playlists
app.post('/api/playlists', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Playlist name is required' });

    db.run("INSERT INTO playlists (name) VALUES (?)", [name], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, name });
    });
});

// GET /api/playlists
app.get('/api/playlists', (req, res) => {
    db.all("SELECT * FROM playlists ORDER BY name", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// POST /api/playlists/:id/songs
app.post('/api/playlists/:id/songs', (req, res) => {
    const { id: playlist_id } = req.params;
    const { song_id } = req.body;
    if (!song_id) return res.status(400).json({ message: 'Song ID is required' });

    db.run("INSERT INTO playlist_songs (playlist_id, song_id) VALUES (?, ?)", [playlist_id, song_id], function(err) {
        if (err) return res.status(500).json({ message: 'Failed to add song to playlist.', error: err.message });
        res.status(201).json({ message: 'Song added to playlist.' });
    });
});

// GET /api/playlists/:id/songs
app.get('/api/playlists/:id/songs', (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT s.* FROM songs s
        INNER JOIN playlist_songs ps ON s.id = ps.song_id
        WHERE ps.playlist_id = ?
    `;
    db.all(query, [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Export initDb para el script de npm
module.exports.initDb = initDb;
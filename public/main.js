document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTOS DEL DOM ---
    const songUrlInput = document.getElementById('song-url');
    const addSongBtn = document.getElementById('add-song-btn');
    const statusMessage = document.getElementById('status-message');
    const songsList = document.getElementById('songs-list');
    const playlistsList = document.getElementById('playlists-list');
    const newPlaylistInput = document.getElementById('new-playlist-name');
    const addPlaylistBtn = document.getElementById('add-playlist-btn');
    
    // Controles de reproducción
    const audioPlayer = document.getElementById('audio-player');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');
    const progressBar = document.getElementById('progress-bar');
    const volumeControl = document.getElementById('volume-control');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    const currentTimeEl = document.getElementById('current-time');
    const totalDurationEl = document.getElementById('total-duration');
    const currentTrackImg = document.getElementById('current-track-img');
    const currentTrackTitle = document.getElementById('current-track-title');
    const currentTrackArtist = document.getElementById('current-track-artist');

    // --- ESTADO DE LA APLICACIÓN ---
    let songs = [];
    let playlists = [];
    let currentSongIndex = -1;
    let isPlaying = false;
    let isShuffle = false;
    let repeatMode = 'none'; // 'none', 'one', 'all'

    // --- FUNCIONES DE API ---
    async function apiRequest(url, method = 'GET', body = null) {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body) options.body = JSON.stringify(body);
        
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            return response.json();
        } catch (error) {
            console.error('API Request Error:', error);
            showStatus(`Error de red: ${error.message}`, 'error');
            throw error;
        }
    }

    // --- FUNCIONES PRINCIPALES ---

    // Descargar una canción
    async function addSong() {
        const url = songUrlInput.value.trim();
        if (!url) {
            showStatus('Por favor, introduce una URL de YouTube.', 'error');
            return;
        }

        showStatus('Descargando canción, por favor espera...', 'loading');
        addSongBtn.disabled = true;

        try {
            const result = await apiRequest('/api/songs/download', 'POST', { url });
            showStatus(result.message, 'success');
            songUrlInput.value = '';
            await loadSongs(); // Recargar la lista de canciones
        } catch (error) {
            // El error ya se muestra en apiRequest
        } finally {
            addSongBtn.disabled = false;
        }
    }

    // Cargar todas las canciones
    async function loadSongs() {
        try {
            const result = await apiRequest('/api/songs');
            songs = result.data;
            updateSongsList();
        } catch (error) {
            // El error ya se muestra en apiRequest
        }
    }
    
    // Cargar todas las playlists
    async function loadPlaylists() {
        try {
            const result = await apiRequest('/api/playlists');
            playlists = result.data;
            updatePlaylistsList();
        } catch (error) {
            // El error ya se muestra en apiRequest
        }
    }
    
    // Crear una nueva playlist
    async function createPlaylist() {
        const name = newPlaylistInput.value.trim();
        if (!name) return;
        
        try {
            await apiRequest('/api/playlists', 'POST', { name });
            newPlaylistInput.value = '';
            await loadPlaylists();
        } catch (error) {
            // El error ya se muestra en apiRequest
        }
    }

    // --- FUNCIONES DEL DOM ---
    function updateSongsList() {
        songsList.innerHTML = '';
        if (songs.length === 0) {
            songsList.innerHTML = '<li>No hay canciones. ¡Añade una!</li>';
            return;
        }
        songs.forEach((song, index) => {
            const li = document.createElement('li');
            li.className = 'song-item';
            li.dataset.index = index;
            li.innerHTML = `
                <img src="${song.thumbnail}" alt="${song.title}" width="50" height="50">
                <div class="song-item-details">
                    <p class="title">${song.title}</p>
                    <p class="artist">${song.artist}</p>
                </div>
                <span class="duration">${formatTime(song.duration)}</span>
            `;
            li.addEventListener('click', () => playSong(index));
            songsList.appendChild(li);
        });
    }

    function updatePlaylistsList() {
        playlistsList.innerHTML = '';
        playlists.forEach(playlist => {
            const li = document.createElement('li');
            li.textContent = playlist.name;
            playlistsList.appendChild(li);
        });
    }

    function showStatus(message, type = 'info') {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        statusMessage.style.display = 'block';
        setTimeout(() => {
            statusMessage.style.display = 'none';
        }, 5000);
    }

    function formatTime(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${min}:${sec}`;
    }

    // --- LÓGICA DEL REPRODUCTOR ---
    function playSong(index) {
        if (index < 0 || index >= songs.length) return;
        
        currentSongIndex = index;
        const song = songs[currentSongIndex];
        
        audioPlayer.src = `/api/songs/${song.id}/stream`;
        audioPlayer.play();
        isPlaying = true;

        updatePlayerUI(song);
    }

    function updatePlayerUI(song) {
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        currentTrackImg.src = song.thumbnail;
        currentTrackTitle.textContent = song.title;
        currentTrackArtist.textContent = song.artist;
        
        document.querySelectorAll('.song-item').forEach(item => item.classList.remove('active'));
        const activeItem = document.querySelector(`.song-item[data-index='${currentSongIndex}']`);
        if (activeItem) activeItem.classList.add('active');
    }

    function togglePlayPause() {
        if (currentSongIndex === -1 && songs.length > 0) {
            playSong(0);
            return;
        }

        if (isPlaying) {
            audioPlayer.pause();
            playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        } else {
            audioPlayer.play();
            playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        }
        isPlaying = !isPlaying;
    }

    function playNext() {
        if (songs.length === 0) return;
        let nextIndex;
        if (isShuffle) {
            nextIndex = Math.floor(Math.random() * songs.length);
            if (nextIndex === currentSongIndex) {
                 nextIndex = (currentSongIndex + 1) % songs.length;
            }
        } else {
            nextIndex = (currentSongIndex + 1) % songs.length;
        }
        playSong(nextIndex);
    }

    function playPrev() {
         if (songs.length === 0) return;
        const prevIndex = (currentSongIndex - 1 + songs.length) % songs.length;
        playSong(prevIndex);
    }
    
    function handleSongEnd() {
        if (repeatMode === 'one') {
            playSong(currentSongIndex);
        } else if (repeatMode === 'all' || !isShuffle) {
            playNext();
        } else if (isShuffle) {
            playNext(); 
        } else if (currentSongIndex === songs.length - 1) {
            // Si es la última canción y no hay repetición ni aleatorio, para.
            togglePlayPause();
        }
    }
    
    function toggleShuffle() {
        isShuffle = !isShuffle;
        shuffleBtn.classList.toggle('active', isShuffle);
    }
    
    function toggleRepeat() {
        const modes = ['none', 'all', 'one'];
        const currentModeIndex = modes.indexOf(repeatMode);
        repeatMode = modes[(currentModeIndex + 1) % modes.length];
        
        repeatBtn.classList.remove('active');
        if (repeatMode === 'one') {
            repeatBtn.innerHTML = '<i class="fas fa-redo-alt"></i><sup>1</sup>';
            repeatBtn.classList.add('active');
        } else if (repeatMode === 'all') {
            repeatBtn.innerHTML = '<i class="fas fa-redo-alt"></i>';
            repeatBtn.classList.add('active');
        } else {
            repeatBtn.innerHTML = '<i class="fas fa-redo"></i>';
        }
    }


    // --- EVENT LISTENERS ---
    addSongBtn.addEventListener('click', addSong);
    addPlaylistBtn.addEventListener('click', createPlaylist);
    playPauseBtn.addEventListener('click', togglePlayPause);
    nextBtn.addEventListener('click', playNext);
    prevBtn.addEventListener('click', playPrev);
    shuffleBtn.addEventListener('click', toggleShuffle);
    repeatBtn.addEventListener('click', toggleRepeat);

    audioPlayer.addEventListener('timeupdate', () => {
        const { currentTime, duration } = audioPlayer;
        if (duration) {
            progressBar.value = (currentTime / duration) * 100;
            currentTimeEl.textContent = formatTime(currentTime);
            totalDurationEl.textContent = formatTime(duration);
        }
    });

    audioPlayer.addEventListener('ended', handleSongEnd);
    
    progressBar.addEventListener('input', () => {
        const { duration } = audioPlayer;
        if (duration) {
            audioPlayer.currentTime = (progressBar.value / 100) * duration;
        }
    });

    volumeControl.addEventListener('input', (e) => {
        audioPlayer.volume = e.target.value;
    });

    // --- INICIALIZACIÓN ---
    async function init() {
        await loadSongs();
        await loadPlaylists();
        
        // Configuración inicial del reproductor
        audioPlayer.volume = volumeControl.value;
    }

    init();
});
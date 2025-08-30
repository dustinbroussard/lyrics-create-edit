document.addEventListener('DOMContentLoaded', () => {
  // Ensure touch devices trigger button actions
  document.addEventListener(
    'touchstart',
    (e) => {
      const btn = e.target.closest('button');
      if (btn) {
        e.preventDefault();
        btn.click();
      }
    },
    { passive: false }
  );
  // === THEME TOGGLE ===
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;

  function attachThemeToggle() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    themeToggleBtn?.addEventListener('click', () => {
      const newTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = newTheme;
      localStorage.setItem('theme', newTheme);
    });
  }
  attachThemeToggle();

  // === TEXT → {lyrics, chords} SPLITTER ===
  function splitLyricsAndChordsFromText(rawText = '') {
    const prefix = (window.CONFIG && window.CONFIG.chordLinePrefix) || '~';
    const hasMarker = rawText
      .split(/\r?\n/)
      .some(line => line.trim().startsWith(prefix));
    // Fast path: no chord markers at all → purely lyrics
    if (!hasMarker && window.CONFIG?.assumeNoChords !== false) {
      return { lyrics: app.normalizeSectionLabels(rawText || ''), chords: '' };
    }

    const lines = (rawText || '').replace(/\r\n?/g, '\n').split('\n');
    const lyricsLines = [];
    const chordLines = [];
    let pendingChord = null;
    const isSection = (s) =>
      /^\s*[\(\[\{].*[\)\]\}]\s*$/.test(s.trim()) || /^\s*\[.*\]\s*$/.test(s.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();
      if (trimmed.startsWith(prefix)) {
        // chord line → keep last one wins
        const chord = trimmed.slice(prefix.length).replace(/^\s/, '');
        pendingChord = chord;
        continue;
      }
      // Treat the line as lyrics (including section labels and blank lines)
      lyricsLines.push(line);
      if (trimmed === '' || isSection(trimmed)) {
        // Never attach chords to empty lines or section labels
        chordLines.push('');
        pendingChord = null;
      } else {
        chordLines.push(pendingChord || '');
        pendingChord = null;
      }
    }

    return {
      lyrics: app.normalizeSectionLabels(lyricsLines.join('\n')),
      chords: chordLines.join('\n')
    };
  }

  // === CLIPBOARD MANAGER ===
  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  class ClipboardManager {
    static async copyToClipboard(text, showToast = true) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          // Fallback for mobile/older browsers
          const textArea = document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        
        if (showToast) {
          this.showToast('Copied to clipboard!', 'success');
        }
        return true;
      } catch (err) {
        console.error('Failed to copy:', err);
        if (showToast) {
          this.showToast('Failed to copy to clipboard', 'error');
        }
        return false;
      }
    }

    static showToast(message, type = 'info') {
      let container = document.querySelector('.toast-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;
      container.appendChild(toast);

      // Trigger animation
      setTimeout(() => toast.classList.add('show'), 10);

      // Remove after 3 seconds with fade out
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }

    static formatLyricsWithChords(lyrics, chords) {
      const lyricLines = lyrics.split('\n');
      const chordLines = chords.split('\n');
      
      return lyricLines.map((lyricLine, i) => {
        const chordLine = chordLines[i] || '';
        if (chordLine.trim()) {
          return `${chordLine}\n${lyricLine}`;
        }
        return lyricLine;
      }).join('\n');
    }
  }

  // === APP LOGIC ===
  const app = {
    songList: document.getElementById('song-list'),
    songs: [],
    currentSongId: null,
    defaultSections: "[Intro]\n\n[Verse 1]\n\n[Pre-Chorus]\n\n[Chorus]\n\n[Verse 2]\n\n[Bridge]\n\n[Outro]",
    sortOrder: localStorage.getItem('songSortOrder') || 'titleAsc',

    async init() {
      try { await window.StorageSafe?.init?.(); } catch {}
      // Load mammoth for DOCX processing
      if (typeof mammoth === 'undefined') {
        console.warn('Mammoth.js not loaded - DOCX support will not work');
      }

      this.loadSongs();
      this.renderSongs();
      this.renderToolbar();
      this.bindEvents();
      this.initDragSort();

      // Handle PWA shortcut-triggered creation
      if (window.__CREATE_NEW_SONG_ON_LOAD__ === true) {
        // Create and navigate to the editor for the new song
        this.createNewSong();
        // Ensure the flag is single-use
        window.__CREATE_NEW_SONG_ON_LOAD__ = false;
      }
    },

    loadSongs() {
      this.songs = JSON.parse(localStorage.getItem('songs') || '[]');
      // Migrate old songs to new format
      this.songs = this.songs.map(song => this.migrateSongFormat(song));
      // Ensure unique IDs across the library
      const changed = this.ensureUniqueIds();
      if (changed) this.saveSongs();
    },

    migrateSongFormat(song) {
      // Ensure all songs have the new metadata fields
      return {
        id: song.id || this.generateId(),
        title: song.title || 'Untitled',
        lyrics: this.normalizeSectionLabels(song.lyrics || ''),
        chords: song.chords || '',
        key: song.key || '',
        tempo: song.tempo || 120,
        timeSignature: song.timeSignature || '4/4',
        notes: song.notes || '',
        createdAt: song.createdAt || new Date().toISOString(),
        lastEditedAt: song.lastEditedAt || new Date().toISOString(),
        tags: song.tags || []
      };
    },

    createSong(title, lyrics = '', chords = '') {
      const normalizedLyrics = lyrics.trim()
        ? this.normalizeSectionLabels(lyrics)
        : this.defaultSections;
      return {
        id: this.generateId(),
        title,
        lyrics: normalizedLyrics,
        chords,
        key: '',
        tempo: 120,
        timeSignature: '4/4',
        notes: '',
        createdAt: new Date().toISOString(),
        lastEditedAt: new Date().toISOString(),
        tags: []
      };
    },

    saveSongs() {
      const data = JSON.stringify(this.songs);
      try {
        localStorage.setItem('songs', data);
      } catch (e) {
        console.warn('localStorage write failed', e);
        try { window.StorageSafe?.snapshotWithData?.(data, 'main:lsFail'); } catch {}
      }
      try { window.StorageSafe?.snapshotLater?.('saveSongs'); } catch {}
    },

    generateId() {
      return (
        Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
      );
    },

    ensureUniqueIds() {
      const seen = new Set();
      let changed = false;
      for (const song of this.songs) {
        let id = String(song.id || '');
        if (!id || seen.has(id)) {
          id = this.generateId();
          song.id = id;
          changed = true;
        }
        seen.add(id);
      }
      return changed;
    },


    normalizeTitle(title) {
      return title
        .replace(/\.[^/.]+$/, '')
        .replace(/[_\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
    },

    normalizeSectionLabels(text = '') {
      const sectionKeywords = [
        'intro',
        'verse',
        'prechorus',
        'chorus',
        'bridge',
        'outro',
        'hook',
        'refrain',
        'coda',
        'solo',
        'interlude',
        'ending',
        'breakdown',
        'tag'
      ];
      return text.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        const match = trimmed.match(/^[\*\s\-_=~`]*[\(\[\{]?\s*([^\]\)\}]+?)\s*[\)\]\}]?[\*\s\-_=~`]*:?$/);
        if (match) {
          const label = match[1].trim();
          const normalized = label.toLowerCase().replace(/[^a-z]/g, '');
          if (sectionKeywords.some(k => normalized.startsWith(k))) {
            const formatted = label
              .replace(/\s+/g, ' ')
              .replace(/(^|\s)\S/g, c => c.toUpperCase());
            return `[${formatted}]`;
          }
        }
        return line;
      }).join('\n');
    },

    cleanAIOutput(text) {
      return text
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/^\s+|\s+$/g, '')
        .replace(/^(Verse|Chorus|Bridge|Outro)[^\n]*$/gmi, '[$1]')
        .replace(/^#+\s*/gm, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^(Capo|Key|Tempo|Time Signature).*$/gmi, '')
        .trim();
    },

    enforceAlternating(lines) {
      const chords = [];
      const lyrics = [];
      for (let i = 0; i < lines.length; i++) {
        if (i % 2 === 0) {
          chords.push(lines[i] || '');
        } else {
          lyrics.push(lines[i] || '');
        }
      }
      return { chords, lyrics };
    },

    parseSongContent(content) {
      const cleaned = this.cleanAIOutput(content || '');
      const lines = cleaned.split(/\r?\n/);
      let lyricsText = cleaned;
      let chordsText = '';
      if (lines.length > 1) {
        const { chords, lyrics } = this.enforceAlternating(lines);
        if (chords.some(line => line.trim() !== '')) {
          chordsText = chords.join('\n');
          lyricsText = lyrics.join('\n');
        }
      }
      lyricsText = this.normalizeSectionLabels(lyricsText);
      return { lyrics: lyricsText, chords: chordsText };
    },

    formatTimeAgo(dateString) {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
      return date.toLocaleDateString();
    },

    highlightMatch(text, query) {
      if (!query) return text;
      const terms = query
        .split(/\s+/)
        .filter(Boolean)
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (!terms.length) return text;
      const regex = new RegExp(`(${terms.join('|')})`, 'ig');
      return text.replace(regex, match => `<strong>${match}</strong>`);
    },

    renderSongs(searchQuery = "") {
      this.songList.innerHTML = '';

      let filtered = this.songs;
      if (searchQuery && searchQuery.trim()) {
        const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
        filtered = this.songs.filter(song => {
          const title = song.title.toLowerCase();
          const tags = (song.tags || []).map(t => t.toLowerCase());
          const key = song.key?.toLowerCase() || '';
          return terms.every(term =>
            title.includes(term) ||
            tags.some(tag => tag.includes(term)) ||
            key.includes(term)
          );
        });
      }

      filtered.sort((a, b) => {
        switch (this.sortOrder) {
          case 'titleDesc':
            return b.title.localeCompare(a.title);
          case 'recent':
            return new Date(b.lastEditedAt) - new Date(a.lastEditedAt);
          default:
            return a.title.localeCompare(b.title);
        }
      });

      if (filtered.length === 0) {
        this.songList.innerHTML = `<p class="empty-state">No songs found.</p>`;
        return;
      }

      for (const song of filtered) {
        const item = document.createElement('div');
        item.className = 'song-item';
        item.dataset.id = song.id;
        
        // Build metadata display
        const metadata = [];
        if (song.key) metadata.push(escapeHtml(song.key));
        if (song.tempo && song.tempo !== 120) metadata.push(`${song.tempo} BPM`);
        if (song.timeSignature && song.timeSignature !== '4/4') metadata.push(escapeHtml(song.timeSignature));
        
        const lastEdited = this.formatTimeAgo(song.lastEditedAt);

        const safeTitleHtml = this.highlightMatch(escapeHtml(song.title), searchQuery);
        const safeTitleAttr = escapeHtml(song.title);
        item.innerHTML = `
          <div class="song-info">
            <span class="song-title">${safeTitleHtml}</span>
            ${metadata.length > 0 ? `<div class="song-metadata">${metadata.join(' • ')}</div>` : ''}
            <div class="song-details">
              <span class="song-tags"></span>
              <span class="song-edited">Last edited: ${lastEdited}</span>
            </div>
          </div>
          <div class="song-actions">
            <i class="fas fa-grip-lines drag-handle" title="Drag to reorder" aria-label="Drag to reorder"></i>
            <button class="song-copy-btn icon-btn" title="Quick Copy" aria-label="Quick copy ${safeTitleAttr}" data-song-id="${song.id}">
              <i class="fas fa-copy"></i>
            </button>
            <a class="song-edit-btn icon-btn edit-song-btn" href="editor/editor.html?songId=${song.id}" title="Edit" aria-label="Edit ${safeTitleAttr}">
              <i class="fas fa-pen"></i>
            </a>
            <button class="song-delete-btn icon-btn delete-song-btn" title="Delete" aria-label="Delete ${safeTitleAttr}" data-song-id="${song.id}">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        `;

        // Safely render tags
        const tagsContainer = item.querySelector('.song-tags');
        if (tagsContainer && song.tags?.length > 0) {
          const frag = document.createDocumentFragment();
          song.tags.forEach(tag => {
            const span = document.createElement('span');
            span.className = 'song-tag';
            span.innerHTML = this.highlightMatch(escapeHtml(tag), searchQuery);
            frag.appendChild(span);
            const comma = document.createTextNode(', ');
            frag.appendChild(comma);
          });
          if (frag.lastChild) frag.removeChild(frag.lastChild);
          tagsContainer.appendChild(frag);
        }

        // Add event listeners
        const copyBtn = item.querySelector('.song-copy-btn');
        copyBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.quickCopySong(song);
        });

        const deleteBtn = item.querySelector('.song-delete-btn');
        deleteBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (confirm(`Delete "${song.title}"?`)) {
            this.songs = this.songs.filter(s => s.id !== song.id);
            this.saveSongs();
            this.renderSongs(searchQuery);
          }
        });

        // Explicitly handle edit link navigation to avoid any
        // interference from other click handlers or mobile quirks
        const editLink = item.querySelector('.song-edit-btn');
        if (editLink) {
          editLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            try { sessionStorage.setItem('lastSongId', String(song.id)); } catch {}
            window.location.href = `editor/editor.html?songId=${song.id}`;
          });
        }

        item.querySelectorAll('.song-tag').forEach(tagEl => {
          tagEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const tag = tagEl.textContent;
            const input = document.getElementById('song-search-input');
            if (input) input.value = tag;
            this.renderSongs(tag);
          });
        });

        item.addEventListener('click', (e) => {
          if (!e.target.closest('.song-actions')) {
            try { sessionStorage.setItem('lastSongId', String(song.id)); } catch {}
            window.location.href = `editor/editor.html?songId=${song.id}`;
          }
      });

      this.songList.appendChild(item);
    }
  },

    initDragSort() {
      if (!this.songList || typeof Sortable === 'undefined') return;
      Sortable.create(this.songList, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'drag-ghost',
        onEnd: () => {
          const order = Array.from(this.songList.children).map(child => child.dataset.id);
          const map = new Map(this.songs.map(s => [s.id, s]));
          this.songs = order.map(id => map.get(id)).filter(Boolean);
          this.saveSongs();
        }
      });
    },

    async quickCopySong(song) {
      // Default to lyrics with chords if available, otherwise just lyrics
      let textToCopy = '';
      if (song.chords && song.chords.trim()) {
        textToCopy = ClipboardManager.formatLyricsWithChords(song.lyrics, song.chords);
      } else {
        textToCopy = song.lyrics || '';
      }
      
      await ClipboardManager.copyToClipboard(textToCopy);
    },

    renderToolbar() {
      const toolbar = document.getElementById('tab-toolbar');
      toolbar.innerHTML = `
        <input type="text" id="song-search-input" class="search-input" placeholder="Search by title, tag, or key...">
        <div class="toolbar-buttons-group">
          <select id="song-sort-select" class="sort-select">
            <option value="titleAsc">Title A–Z</option>
            <option value="titleDesc">Title Z–A</option>
            <option value="recent">Recently Edited</option>
          </select>
          <button id="add-song-btn" class="btn icon-btn" title="Add Song"><i class="fas fa-plus"></i></button>
          <button id="export-library-btn" class="btn icon-btn" title="Export Library"><i class="fas fa-download"></i></button>
          <button id="normalize-library-btn" class="btn icon-btn" title="Normalize Library"><i class="fas fa-broom"></i></button>
          <button id="import-clipboard-btn" class="btn icon-btn" title="Paste Song"><i class="fas fa-paste"></i></button>
          <button id="delete-all-songs-btn" class="btn icon-btn danger" title="Delete All Songs"><i class="fas fa-trash"></i></button>
          <label for="song-upload-input" class="btn icon-btn" title="Upload Files"><i class="fas fa-upload"></i></label>
        </div>
        <input type="file" id="song-upload-input" multiple accept=".txt,.docx,.json" class="hidden-file">
      `;

      document.getElementById('song-sort-select').value = this.sortOrder;
      document.getElementById('song-sort-select')?.addEventListener('change', (e) => {
        this.sortOrder = e.target.value;
        localStorage.setItem('songSortOrder', this.sortOrder);
        const query = document.getElementById('song-search-input')?.value || '';
        this.renderSongs(query);
      });

      document.getElementById('add-song-btn')?.addEventListener('click', () => this.createNewSong());
      document.getElementById('export-library-btn')?.addEventListener('click', () => {
        const includeMetadata = confirm('Include metadata in export?');
        this.exportLibrary(includeMetadata);
      });
      document.getElementById('normalize-library-btn')?.addEventListener('click', () => this.normalizeLibrary());
      document.getElementById('import-clipboard-btn')?.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text.trim()) {
            const title = prompt("Title for pasted song?", "New Song");
            if (title) {
              const { lyrics, chords } = splitLyricsAndChordsFromText(text);
              const newSong = this.createSong(title, lyrics, chords);
              this.songs.push(newSong);
              this.saveSongs();
              this.renderSongs();
            }
          } else {
            ClipboardManager.showToast('Clipboard is empty', 'info');
          }
        } catch (err) {
          console.error('Clipboard read failed', err);
          ClipboardManager.showToast('Clipboard not accessible', 'error');
        }
      });
      document.getElementById('delete-all-songs-btn')?.addEventListener('click', () => this.confirmDeleteAll());
      document.getElementById('song-search-input')?.addEventListener('input', (e) => {
        const query = e.target.value;
        this.renderSongs(query);
      });

      document.getElementById('song-upload-input')?.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        // Check if it's a JSON library import
        const jsonFiles = files.filter(f => f.name.endsWith('.json'));
        if (jsonFiles.length > 0) {
          await this.importLibrary(jsonFiles[0]);
          e.target.value = "";
          return;
        }

        const processFile = (file) => {
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
              let content = e.target.result;

              if (file.name.endsWith('.docx')) {
                try {
                  const result = await mammoth.extractRawText({ arrayBuffer: e.target.result });
                  content = result.value;
                } catch (err) {
                  console.error('Error processing DOCX:', err);
                  return resolve(null);
                }
              }

              // Extract title from filename (without extension)
              const title = this.normalizeTitle(file.name);
              const parsed = splitLyricsAndChordsFromText(String(content || '').trim());

              if (title && (parsed.lyrics?.trim()?.length || parsed.chords?.trim()?.length)) {
                resolve(this.createSong(title, parsed.lyrics, parsed.chords));
              } else {
                resolve(null);
              }
            };

            if (file.name.endsWith('.docx')) {
              reader.readAsArrayBuffer(file);
            } else {
              reader.readAsText(file);
            }
          });
        };

        ClipboardManager.showToast(`Processing ${files.length} file(s)...`, 'info');

        const songs = await Promise.all(files.map(processFile));
        const validSongs = songs.filter(Boolean);
        this.songs.push(...validSongs);
        const importCount = validSongs.length;

        this.saveSongs();
        this.renderSongs();
        ClipboardManager.showToast(`Imported ${importCount} song(s)`, 'success');
        e.target.value = ""; // Clear input
      });
    },

    createNewSong() {
      const newSong = this.createSong('New Song', '');
      this.songs.push(newSong);
      this.saveSongs();
      // Redirect to editor for the new song
      try { sessionStorage.setItem('lastSongId', String(newSong.id)); } catch {}
      window.location.href = `editor/editor.html?songId=${newSong.id}`;
    },

    async exportLibrary(includeMetadata = true) {
      try {
        const songs = includeMetadata
          ? this.songs
          : this.songs.map(({ title, lyrics, chords }) => ({ title, lyrics, chords }));
        // Create export data
        const exportData = {
          version: '1.0',
          exportDate: new Date().toISOString(),
          songCount: songs.length,
          songs
        };

        // Create and download JSON file
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `lyricsmith-library-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        ClipboardManager.showToast(`Exported ${this.songs.length} songs`, 'success');
      } catch (err) {
        console.error('Export failed:', err);
        ClipboardManager.showToast('Export failed', 'error');
      }
    },

    async importLibrary(file) {
      try {
        const text = await file.text();
        const importData = JSON.parse(text);
        
        // Validate import data
        if (!importData.songs || !Array.isArray(importData.songs)) {
          throw new Error('Invalid library format');
        }

        // Confirm import
        const confirmMsg = `Import ${importData.songs.length} songs? This will add to your existing library.`;
        if (!confirm(confirmMsg)) return;

        // Process and migrate imported songs
        let importCount = 0;
        for (const songData of importData.songs) {
          const song = this.migrateSongFormat(songData);
          // Generate new ID to avoid conflicts
          song.id = Date.now().toString() + Math.random().toString(36).slice(2, 11);
          song.lastEditedAt = new Date().toISOString();
          this.songs.push(song);
          importCount++;
        }

        this.saveSongs();
        this.renderSongs();
        ClipboardManager.showToast(`Imported ${importCount} songs`, 'success');
      } catch (err) {
        console.error('Import failed:', err);
        ClipboardManager.showToast('Import failed - invalid file format', 'error');
      }
    },

    normalizeLibrary() {
      try {
        let idFixes = 0;
        let normalized = 0;
        // Ensure unique IDs
        const beforeIds = new Set(this.songs.map(s => String(s.id || '')));
        if (this.ensureUniqueIds()) {
          const afterIds = new Set(this.songs.map(s => String(s.id)));
          idFixes = Math.max(0, beforeIds.size - afterIds.size);
        }

        // Normalize song fields using migrateSongFormat
        this.songs = this.songs.map((song) => {
          const migrated = this.migrateSongFormat(song);
          // Keep original timestamps if present
          migrated.createdAt = song.createdAt || migrated.createdAt;
          migrated.lastEditedAt = song.lastEditedAt || migrated.lastEditedAt;
          if (JSON.stringify(song) != JSON.stringify(migrated)) normalized++;
          return migrated;
        });

        this.saveSongs();
        const msg = `Library normalized${idFixes ? `, fixed IDs: ${idFixes}` : ''}${normalized ? `, updated: ${normalized}` : ''}`;
        ClipboardManager.showToast(msg, 'success');
        const query = document.getElementById('song-search-input')?.value || '';
        this.renderSongs(query);
      } catch (e) {
        console.error('Normalize failed', e);
        ClipboardManager.showToast('Normalize failed', 'error');
      }
    },

    confirmDeleteAll() {
      if (confirm("Delete all songs? This cannot be undone.")) {
        this.songs = [];
        this.saveSongs();
        this.renderSongs();
        ClipboardManager.showToast('All songs deleted', 'info');
      }
    },

    bindEvents() {
      // Add keyboard shortcuts
      document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + N for new song
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
          e.preventDefault();
          this.createNewSong();
        }
        
        // Ctrl/Cmd + E for export
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
          e.preventDefault();
          this.exportLibrary();
        }
      });

      // Focus search on '/' key
      document.addEventListener('keydown', (e) => {
        if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          document.getElementById('song-search-input')?.focus();
        }
      });
    }
  };

  app.init();
  window.app = app;
});

const SCHEMA_VERSION = 1;
// Enhanced song data structure with metadata
const defaultSections = "[Intro]\n\n[Verse 1]\n\n[Pre-Chorus]\n\n[Chorus]\n\n[Verse 2]\n\n[Bridge]\n\n[Outro]";

const normalizeSectionLabels = (text = '') => {
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
};

const cleanAIOutput = (text) => {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/<\/?(think|reasoning|analysis)>[\s\S]*?<\/(think|reasoning|analysis)>/gim, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/(^|\n)\s*(analysis|reasoning|thoughts?|notes?|explanation)\s*:\s*[\s\S]*?(\n\s*\n|$)/gim, '$3')
        .replace(/^\s*(Sure,|Here(?:'|)s|Of course,|Absolutely,|Let(?:'|)s)\b.*?\n+/gim, '')
        .replace(/^#+\s*/gm, '')
        .replace(/^(Capo|Key|Tempo|Time Signature).*$/gmi, '')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\s+|\s+$/g, '')
        .replace(/^(Verse|Chorus|Bridge|Outro)[^\n]*$/gmi, '[$1]')
        .trim();
};

const enforceAlternating = (lines) => {
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
};

const createSong = (title, lyrics = '', chords = '') => ({
    _v: SCHEMA_VERSION,
    id: Date.now().toString(),
    title,
    lyrics: lyrics.trim() ? normalizeSectionLabels(cleanAIOutput(lyrics)) : defaultSections,
    chords: cleanAIOutput(chords),
    // New metadata fields
    key: '',
    tempo: 120,
    timeSignature: '4/4',
    notes: '', // Footer notes
    createdAt: new Date().toISOString(),
    lastEditedAt: new Date().toISOString(),
    tags: []
});

// Enhanced clipboard functionality for mobile
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
        // Remove existing toasts
        document.querySelectorAll('.toast').forEach(toast => toast.remove());
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);
        
        // Remove after 3 seconds
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

    static formatSongForExport(song, includeMetadata = true) {
        let output = '';
        
        if (includeMetadata) {
            output += `# ${song.title}\n\n`;
            if (song.key) output += `**Key:** ${song.key}\n`;
            if (song.tempo) output += `**Tempo:** ${song.tempo} BPM\n`;
            if (song.timeSignature) output += `**Time Signature:** ${song.timeSignature}\n`;
            if (song.tags.length > 0) output += `**Tags:** ${song.tags.join(', ')}\n`;
            output += '\n---\n\n';
        }
        
        // Add lyrics with chords
        if (song.chords && song.chords.trim()) {
            output += this.formatLyricsWithChords(song.lyrics, song.chords);
        } else {
            output += song.lyrics;
        }
        
        if (song.notes && song.notes.trim()) {
            output += '\n\n---\n**Notes:**\n' + song.notes;
        }
        
        return output;
    }
}

// Song metadata editor component
const createMetadataEditor = (song) => `
    <div class="metadata-editor">
        <div class="metadata-row">
            <label for="song-key">Key:</label>
            <select id="song-key" value="${song.key || ''}">
                <option value="">Select Key</option>
                <option value="C">C</option>
                <option value="C#">C#</option>
                <option value="D">D</option>
                <option value="D#">D#</option>
                <option value="E">E</option>
                <option value="F">F</option>
                <option value="F#">F#</option>
                <option value="G">G</option>
                <option value="G#">G#</option>
                <option value="A">A</option>
                <option value="A#">A#</option>
                <option value="B">B</option>
            </select>
        </div>
        
        <div class="metadata-row">
            <label for="song-tempo">Tempo (BPM):</label>
            <input type="number" id="song-tempo" value="${song.tempo || 120}" min="60" max="240">
        </div>
        
        <div class="metadata-row">
            <label for="song-time-signature">Time Signature:</label>
            <select id="song-time-signature" value="${song.timeSignature || '4/4'}">
                <option value="4/4">4/4</option>
                <option value="3/4">3/4</option>
                <option value="2/4">2/4</option>
                <option value="6/8">6/8</option>
                <option value="12/8">12/8</option>
            </select>
        </div>
        
        <div class="metadata-row">
            <label for="song-notes">Notes:</label>
            <textarea id="song-notes" placeholder="Performance notes, structure, etc.">${song.notes || ''}</textarea>
        </div>
        
        <div class="metadata-row">
            <label for="song-tags">Tags:</label>
            <input type="text" id="song-tags" placeholder="rock, ballad, easy" value="${song.tags ? song.tags.join(', ') : ''}">
            <small>Separate tags with commas</small>
        </div>
    </div>
`;

// Update song list item to show metadata
const createSongListItem = (song) => {
    const lastEdited = new Date(song.lastEditedAt).toLocaleDateString();
    const metadata = [];
    if (song.key) metadata.push(song.key);
    if (song.tempo) metadata.push(`${song.tempo} BPM`);
    if (song.timeSignature && song.timeSignature !== '4/4') metadata.push(song.timeSignature);
    
    return `
        <div class="song-item" data-id="${song.id}">
            <div class="song-info">
                <span class="song-title">${song.title}</span>
                ${metadata.length > 0 ? `<div class="song-metadata">${metadata.join(' • ')}</div>` : ''}
                <div class="song-details">
                    ${song.tags.length > 0 ? `<span class="song-tags">${song.tags.join(', ')}</span>` : ''}
                    <span class="song-edited">Last edited: ${lastEdited}</span>
                </div>
            </div>
            <div class="song-actions">
                <button class="song-copy-btn icon-btn" title="Quick Copy">
                    <i class="fas fa-copy"></i>
                </button>
                <a class="song-edit-btn edit-song-btn" href="./editor.html?songId=${song.id}" title="Edit">
                    <i class="fas fa-pen"></i>
                </a>
                <button class="song-delete-btn danger delete-song-btn" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
};

// Usage in editor.js for handling copy operations
const handleCopyOperation = async (song, copyType) => {
    let textToCopy = '';
    
    switch (copyType) {
        case 'raw':
            textToCopy = song.lyrics || '';
            break;
        case 'chords':
            textToCopy = ClipboardManager.formatLyricsWithChords(song.lyrics, song.chords);
            break;
        case 'formatted':
            textToCopy = ClipboardManager.formatSongForExport(song, true);
            break;
        case 'metadata':
            textToCopy = `${song.title}\nKey: ${song.key || 'N/A'}\nTempo: ${song.tempo} BPM\nTime: ${song.timeSignature}\nTags: ${song.tags.join(', ')}`;
            break;
        default:
            textToCopy = song.lyrics || '';
    }
    
    return await ClipboardManager.copyToClipboard(textToCopy);
};

// Save song with updated metadata
const saveCurrentSongWithMetadata = (song) => {
    // Update metadata from form
    song.key = document.getElementById('song-key')?.value || '';
    song.tempo = parseInt(document.getElementById('song-tempo')?.value) || 120;
    song.timeSignature = document.getElementById('song-time-signature')?.value || '4/4';
    song.notes = document.getElementById('song-notes')?.value || '';
    
    // Parse tags
    const tagsInput = document.getElementById('song-tags')?.value || '';
    song.tags = tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    
    // Update timestamp
    song.lastEditedAt = new Date().toISOString();
    
    // Save to localStorage
    const songs = JSON.parse(localStorage.getItem('songs') || '[]');
    const songIndex = songs.findIndex(s => s.id === song.id);
    if (songIndex !== -1) {
        songs[songIndex] = song;
        try { localStorage.setItem('songs', JSON.stringify(songs)); window.StorageSafe?.snapshotLater?.('editor:metaSave'); } catch {}
    }
    
    return song;
};


function safeLocalStorageSet(key, value) {
    try { localStorage.setItem(key, value); try { window.StorageSafe?.snapshotLater?.('editor:helperSet'); } catch {} return true; }
    catch (e) { console.warn('localStorage write failed', e); try { window.StorageSafe?.snapshotWithData?.(value, 'editor:helperFail'); } catch {} return false; }
}
function safeLocalStorageGet(key, fallback='[]') {
    try { return localStorage.getItem(key) ?? fallback; }
    catch(e){ return fallback; }
}


function exportAllSongs(filename = 'lyricsmith_songs.json') {
    const data = safeLocalStorageGet('songs', '[]');
    const blob = new Blob([data], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


async function importSongs(file) {
    try {
        const text = await file.text();
        const incoming = JSON.parse(text);
        if (!Array.isArray(incoming)) throw new Error('Invalid format');
        const existing = JSON.parse(safeLocalStorageGet('songs', '[]'));
        const byId = new Map(existing.map(s => [s.id, s]));
        for (const s of incoming) {
            byId.set(s.id, { ...byId.get(s.id), ...s });
        }
        const merged = Array.from(byId.values());
        if (!safeLocalStorageSet('songs', JSON.stringify(merged))) throw new Error('Storage failed');
        try { window.StorageSafe?.snapshotLater?.('editor:import'); } catch {}
        return merged;
    } catch (e) {
        console.error('importSongs failed', e);
        throw e;
    }
}

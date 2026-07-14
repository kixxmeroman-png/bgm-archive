let bgms = JSON.parse(localStorage.getItem('box_bgms')) || [];
let folders = JSON.parse(localStorage.getItem('box_folders')) || [];
let playlists = JSON.parse(localStorage.getItem('box_playlists')) || [];

let currentFilter = { type: 'all', id: null }; 
let viewMode = 'list'; 
let cardCols = 3; 
let sortMode = localStorage.getItem('box_sort_mode') || 'reg'; 
let sortableInstance = null; 

function saveData() {
    localStorage.setItem('box_bgms', JSON.stringify(bgms));
    localStorage.setItem('box_folders', JSON.stringify(folders));
    localStorage.setItem('box_playlists', JSON.stringify(playlists));
}

function toggleExportMenu(event) {
    if(event) event.stopPropagation();
    const menu = document.getElementById('export-dropdown');
    if (menu) menu.classList.toggle('hidden');
}

window.addEventListener('click', function() {
    const menu = document.getElementById('export-dropdown');
    if(menu) menu.classList.add('hidden');
});

function downloadBackupJSON() {
    if (bgms.length === 0 && folders.length === 0 && playlists.length === 0) {
        showToast("백업할 데이터가 비어 있습니다.");
        return;
    }
    const backupPayload = {
        bgms: bgms,
        folders: folders,
        playlists: playlists,
        exportedAt: new Date().toISOString()
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupPayload, null, 4));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `bgm_manager_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("보관함 데이터 JSON 백업 완!");
}

function downloadBackupCSV() {
    if (bgms.length === 0) {
        showToast("내보낼 BGM 데이터가 없습니다.");
        return;
    }
    const headers = ["이름(지정명)", "원제(유튜브)", "유튜브 링크", "소속 폴더", "메모", "태그 목록"];
    const rows = bgms.map(bgm => {
        const folderObj = folders.find(f => f.id === bgm.folderId);
        const folderName = folderObj ? folderObj.name : "없음";
        const tagsStr = bgm.tags.join(', ');
        return [
            bgm.customTitle,
            bgm.realTitle,
            bgm.youtubeUrl,
            folderName,
            bgm.memo || "",
            tagsStr
        ];
    });
    const csvContent = [headers, ...rows].map(row => 
        row.map(value => {
            const errorFreeValue = value === null || value === undefined ? "" : value;
            const escaped = String(errorFreeValue).replace(/"/g, '""');
            return `"${escaped}"`;
        }).join(',')
    ).join('\r\n');
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", url);
    downloadAnchor.setAttribute("download", `bgm_manager_list_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
    showToast("BGM 리스트가 CSV 파일로 변환되었습니다!");
}

function extractYoutubeId(url) {
    if(!url) return null;
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[7] && match[7].length === 11) return match[7].trim();
    try {
        if(url.includes('youtu.be/')) return url.split('youtu.be/')[1].split(/[?#&]/)[0].trim();
    } catch(e) {}
    return null;
}

function getYoutubeThumbnail(youtubeId) {
    return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
}

async function fetchYoutubeTitle(youtubeId) {
    try {
        const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${youtubeId}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.title || null;
    } catch (error) {
        return null;
    }
}

function openContainerModal(type) {
    const modal = document.getElementById('container-modal');
    const title = document.getElementById('container-modal-title');
    const typeInput = document.getElementById('container-modal-type');
    const textInput = document.getElementById('container-modal-input');
    typeInput.value = type;
    textInput.value = '';
    title.innerText = type === 'folder' ? '📁 새 폴더 만들기' : '🎧 새 플레이리스트 만들기';
    textInput.placeholder = type === 'folder' ? '폴더 이름 입력...' : '플레이리스트 이름 입력...';
    modal.classList.remove('hidden');
    textInput.focus();
}

function closeContainerModal() {
    document.getElementById('container-modal').classList.add('hidden');
}

function submitContainerForm() {
    const type = document.getElementById('container-modal-type').value;
    const name = document.getElementById('container-modal-input').value.trim();
    if(!name) return;
    if(type === 'folder') {
        folders.push({ id: 'f_' + Date.now(), name: name, bgmIds: [] });
        showToast('새 폴더가 등록되었습니다.');
    } else {
        playlists.push({ id: 'p_' + Date.now(), name: name, bgmIds: [] });
        showToast('새 플레이리스트가 등록되었습니다.');
    }
    saveData();
    closeContainerModal();
    renderAll();
}

function openPlaylistModal() {
    const select = document.getElementById('playlist-target-folder');
    select.innerHTML = '<option value="">폴더 미지정 상태로 등록</option>';
    folders.forEach(f => { select.innerHTML += `<option value="${f.id}">${f.name}</option>`; });
    document.getElementById('playlist-url-input').value = '';
    document.getElementById('playlist-modal').classList.remove('hidden');
}

function closePlaylistModal() {
    document.getElementById('playlist-modal').classList.add('hidden');
}

/**
 * 정밀 파서 수정본 (안정적인 구조로 리팩토링)
 */
function parseYoutubePlaylistSource(inputText) {
    const videoMap = new Map();
    
    // 단순한 문자열 기반 정규식으로 전환하여 문법 오류(Syntax) 위험을 최소화함
    const regex = /"accessibilityContext"\s*:\s*\{\s*"label"\s*:\s*"([^"]+)"\s*\}\s*,\s*"commandContext"[\s\S]*?"url"\s*:\s*"([^"]+)"/g;
    
    let match;
    while ((match = regex.exec(inputText)) !== null) {
        let labelTitle = match[1];
        const rawUrl = match[2];
        
        // '/watch?v=xxxx' 형태에서 ID 추출
        const videoId = extractYoutubeId("https://www.youtube.com" + rawUrl);
        if (!videoId) continue;

        // "2분 52초" 와 같은 뒤쪽 재생 시간 텍스트 제거
        labelTitle = labelTitle.replace(/\s*\d+분\s*\d+초\s*$/, '');
        
        let cleanTitle = labelTitle
            .replace(/\\u0026/g, '&')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\')
            .trim();
            
        videoMap.set(videoId, cleanTitle);
    }

    // 예외 상황 대비 백업 파서 (기존 playlistVideoRenderer 구조 추적)
    if (videoMap.size === 0) {
        const idRegex = /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g;
        let match;
        while ((match = idRegex.exec(inputText)) !== null) {
            const videoId = match[1];
            if (!videoMap.has(videoId)) {
                videoMap.set(videoId, null);
            }
        }
    }

    return videoMap;
}

async function fetchAndAddPlaylist() {
    const urlInput = document.getElementById('playlist-url-input');
    const btn = document.getElementById('playlist-btn');
    const targetFolderId = document.getElementById('playlist-target-folder').value;
    const inputText = urlInput.value.trim();

    if (!inputText) {
        alert("유튜브 재생목록 소스코드를 입력해주세요!");
        return;
    }

    btn.disabled = true;
    btn.innerText = "소스 코드 정밀 파싱 중...";

    try {
        const videoMap = parseYoutubePlaylistSource(inputText);

        if (videoMap.size === 0) {
            alert("⚠️ 입력한 텍스트에서 비디오 코드를 인식하지 못했습니다.\n'Ctrl + U'로 페이지 소스 전체를 복사했는지 확인해주세요!");
            return;
        }

        let addedCount = 0;

        for (let [videoId, videoTitle] of videoMap) {
            if (!bgms.some(b => b.youtubeId === videoId)) {
                const finalTitle = videoTitle || `가져온 BGM (${videoId})`;
                
                const newBgm = {
                    id: 'bgm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    youtubeUrl: "https://www.youtube.com/watch?v=" + videoId,
                    youtubeId: videoId,
                    realTitle: finalTitle,
                    customTitle: finalTitle,  
                    memo: "",                
                    tags: [],
                    folderId: targetFolderId || null
                };
                
                bgms.push(newBgm);

                if (targetFolderId) {
                    const folder = folders.find(f => f.id === targetFolderId);
                    if (folder) folder.bgmIds.push(newBgm.id);
                }
                addedCount++;
            }
        }

        if (addedCount > 0) {
            saveData();
            closePlaylistModal();
            showToast(`🎉 성공! 재생목록에서 본래 제목을 매칭하여 총 ${addedCount}개의 BGM을 보관함에 추가했습니다.`);
            renderAll();
        } else {
            alert("중복된 음원을 제외하고 새로 추가할 비디오가 없습니다.");
        }

    } catch (error) {
        console.error(error);
        alert("파싱 중 예기치 못한 에러가 발생했습니다.");
    } finally {
        btn.disabled = false;
        btn.innerText = "불러오기";
    }
}

function openAddModal() {
    document.getElementById('add-modal').classList.remove('hidden');
}

function closeAddModal() {
    document.getElementById('add-modal').classList.add('hidden');
    document.getElementById('input-links').value = '';
}

async function addMultipleBgm() {
    const textarea = document.getElementById('input-links');
    const lines = textarea.value.split('\n');
    const targetFolderId = document.getElementById('select-target-folder').value;
    let addedCount = 0;

    showToast('유튜브 정보를 분석하여 등록 중입니다...');

    for (const line of lines) {
        const trimmed = line.trim();
        if(!trimmed) continue;

        let customName = "";
        let targetUrl = trimmed;

        if (trimmed.includes(' - ')) {
            const parts = trimmed.split(' - ');
            customName = parts[0].trim();
            targetUrl = parts[1].trim();
        }

        const ytId = extractYoutubeId(targetUrl);
        if(ytId) {
            const cleanId = ytId.trim();
            let fetchedTitle = await fetchYoutubeTitle(cleanId);
            let finalRealTitle = fetchedTitle || `YouTube 비디오 (${cleanId})`;
            let finalCustomName = customName || fetchedTitle || "이름 없는 BGM";

            const newBgm = {
                id: 'bgm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                youtubeUrl: `https://www.youtube.com/watch?v=${cleanId}`,
                youtubeId: cleanId,
                realTitle: finalRealTitle, 
                customTitle: finalCustomName,
                memo: '',
                tags: [],
                folderId: targetFolderId || null
            };
            bgms.push(newBgm);
            
            if(targetFolderId) {
                const folder = folders.find(f => f.id === targetFolderId);
                if(folder) folder.bgmIds.push(newBgm.id);
            }
            addedCount++;
        }
    }

    if(addedCount > 0) {
        saveData();
        closeAddModal();
        showToast(`${addedCount}개의 BGM 보관 완료!`);
        renderAll();
    } else {
        showToast('올바른 유튜브 링크를 찾을 수 없습니다.');
    }
}

function renameContainer(type, id, currentName, event) {
    if(event) event.stopPropagation();
    const newName = prompt(`새로운 이름을 입력하세요:`, currentName);
    if(!newName || !newName.trim()) return;

    if(type === 'folder') {
        const f = folders.find(item => item.id === id);
        if(f) f.name = newName.trim();
    } else {
        const p = playlists.find(item => item.id === id);
        if(p) p.name = newName.trim();
    }
    saveData();
    renderAll();
}

function openBgmModal(id) {
    const bgm = bgms.find(b => b.id === id);
    if(!bgm) return;

    document.getElementById('modal-bgm-id').value = bgm.id;
    document.getElementById('modal-custom-title').value = bgm.customTitle;
    document.getElementById('modal-real-title').value = bgm.realTitle;
    document.getElementById('modal-memo').value = bgm.memo;
    document.getElementById('modal-tags').value = bgm.tags.join(', ');

    refreshModalBelongInfo(bgm.id);

    const fSelect = document.getElementById('modal-select-folder');
    fSelect.innerHTML = '<option value="">미지정(폴더 없음)</option>';
    folders.forEach(f => {
        fSelect.innerHTML += `<option value="${f.id}" ${bgm.folderId === f.id ? 'selected' : ''}>${f.name}</option>`;
    });

    const pSelect = document.getElementById('modal-select-playlist');
    pSelect.innerHTML = '<option value="">+ 플레이리스트 등록</option>';
    playlists.forEach(p => { pSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`; });

    document.getElementById('bgm-modal').classList.remove('hidden');

    const holder = document.getElementById('iframe-player-holder');
    holder.innerHTML = `<iframe class="w-full h-full" src="https://www.youtube-nocookie.com/embed/${bgm.youtubeId.trim()}?autoplay=1&controls=1&rel=0&enablejsapi=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
}

function excludeBgmFromTarget(bgmId, type, targetId, event) {
    if(event) event.stopPropagation();
    const bgm = bgms.find(b => b.id === bgmId);
    if(!bgm) return;

    if(type === 'folder') {
        if(bgm.folderId === targetId) {
            bgm.folderId = null;
            const f = folders.find(folder => folder.id === targetId);
            if(f) {
                f.bgmIds = f.bgmIds.filter(id => id !== bgmId);
            }
            showToast('폴더에서 BGM이 제외되었습니다.');
        }
    } else if(type === 'playlist') {
        const p = playlists.find(pl => pl.id === targetId);
        if(p) {
            p.bgmIds = p.bgmIds.filter(id => id !== bgmId);
            showToast('플레이리스트에서 BGM이 제외되었습니다.');
        }
    }

    saveData();
    
    if(!document.getElementById('bgm-modal').classList.contains('hidden')) {
        refreshModalBelongInfo(bgmId);
    }
    renderAll();
}

function refreshModalBelongInfo(bgmId) {
    const bgm = bgms.find(b => b.id === bgmId);
    if(!bgm) return;
    const curFolder = folders.find(f => f.id === bgm.folderId);
    const curPls = playlists.filter(p => p.bgmIds.includes(bgm.id));
    
    let folderBadge = '<span class="text-gray-400">없음</span>';
    if (curFolder) {
        folderBadge = `
            <span class="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-[11px] px-2 py-0.5 rounded border border-gray-200 font-bold">
                ${curFolder.name}
                <button onclick="excludeBgmFromTarget('${bgm.id}', 'folder', '${curFolder.id}', event)" class="hover:text-rose-500 font-extrabold cursor-pointer text-xs ml-1" title="제외하기">✕</button>
            </span>`;
    }
    
    let belongHtml = `<div class="flex items-center gap-1.5 flex-wrap">📌 <b class="text-gray-700">소속 폴더:</b> ${folderBadge}</div>`;
    
    let plBadgesHtml = curPls.map(p => `
                <span class="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-[11px] px-2 py-0.5 rounded border border-gray-200 font-bold">
                    ${p.name}
                    <button onclick="excludeBgmFromTarget('${bgm.id}', 'playlist', '${p.id}', event)" class="hover:text-rose-500 font-extrabold cursor-pointer text-xs ml-1" title="제외하기">✕</button>
                </span>`).join(' ');
        
    belongHtml += `<div class="flex items-center gap-1.5 flex-wrap">🎵 <b class="text-gray-700">포함 플레이리스트:</b> ${plBadgesHtml || '<span class="text-gray-400">없음</span>'}</div>`;
    
    document.getElementById('modal-belong-info').innerHTML = belongHtml;
}

function addPlaylistFromModal(playlistId) {
    if(!playlistId) return;
    const bgmId = document.getElementById('modal-bgm-id').value;
    const target = playlists.find(p => p.id === playlistId);
    if(target && !target.bgmIds.includes(bgmId)) {
        target.bgmIds.push(bgmId);
        saveData();
        showToast(`[${target.name}] 추가 완료!`);
        refreshModalBelongInfo(bgmId);
    } else {
        showToast(`이미 등록된 플레이리스트입니다.`);
    }
}

function closeModal() {
    document.getElementById('bgm-modal').classList.add('hidden');
    document.getElementById('iframe-player-holder').innerHTML = '';
}

function saveModalDetails() {
    const id = document.getElementById('modal-bgm-id').value;
    const bgm = bgms.find(b => b.id === id);
    if(!bgm) return;

    bgm.customTitle = document.getElementById('modal-custom-title').value.trim() || '이름 없는 BGM';
    bgm.realTitle = document.getElementById('modal-real-title').value.trim() || '원본 타이틀 없음';
    bgm.memo = document.getElementById('modal-memo').value.trim();
    
    const tagsRaw = document.getElementById('modal-tags').value.trim();
    bgm.tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(t => t) : [];

    const nextFolderId = document.getElementById('modal-select-folder').value || null;
    if(bgm.folderId !== nextFolderId) {
        folders.forEach(f => f.bgmIds = f.bgmIds.filter(bid => bid !== id));
        if(nextFolderId) {
            const targetF = folders.find(f => f.id === nextFolderId);
            if(targetF) targetF.bgmIds.push(id);
        }
        bgm.folderId = nextFolderId;
    }

    saveData();
    closeModal();
    renderAll();
    showToast('변경사항이 저장되었습니다.');
}

function deleteBgmFromModal() {
    const id = document.getElementById('modal-bgm-id').value;
    if(!confirm('이 BGM을 아카이브 보관함에서 완전히 삭제하시겠습니까?')) return;
    bgms = bgms.filter(b => b.id !== id);
    folders.forEach(f => f.bgmIds = f.bgmIds.filter(bid => bid !== id));
    playlists.forEach(p => p.bgmIds = p.bgmIds.filter(bid => bid !== id));
    saveData(); closeModal(); renderAll();
}

function deleteBgmDirect(bgmId, bgmTitle, event) {
    if(event) event.stopPropagation(); 
    const confirmDelete = confirm(`"${bgmTitle}"\n\n이 BGM을 아카이브 보관함에서 완전히 삭제하시겠습니까?`);
    if(!confirmDelete) return;

    try {
        bgms = bgms.filter(b => b.id !== bgmId);
        folders.forEach(f => f.bgmIds = f.bgmIds.filter(bid => bid !== bgmId));
        playlists.forEach(p => p.bgmIds = p.bgmIds.filter(bid => bid !== bgmId));
        saveData();
        showToast("🗑️ BGM이 아카이브에서 삭제되었습니다.");
        renderAll();
    } catch (error) {
        console.error(error);
    }
}

function copyLink(url, e) {
    if(e) e.stopPropagation(); 
    navigator.clipboard.writeText(url).then(() => { showToast('클립보드에 주소가 복사되었습니다.'); });
}

function moveBgmToContainer(bgmId, type, containerId, e) {
    if(e) e.stopPropagation();
    if(type === 'folder') {
        folders.forEach(f => f.bgmIds = f.bgmIds.filter(bid => bid !== bgmId));
        const target = folders.find(f => f.id === containerId);
        if(target) target.bgmIds.push(bgmId);
        const bgm = bgms.find(b => b.id === bgmId);
        if(bgm) bgm.folderId = containerId;
    } else if(type === 'playlist') {
        const target = playlists.find(p => p.id === containerId);
        if(target && !target.bgmIds.includes(bgmId)) target.bgmIds.push(bgmId);
    }
    saveData();
    renderAll();
    showToast('그룹 소속이 동적으로 변경되었습니다.');
}

function toggleAllCheckboxes(masterCheckbox) {
    const checkboxes = document.querySelectorAll('.bgm-item-checkbox');
    checkboxes.forEach(cb => cb.checked = masterCheckbox.checked);
}

function applyBulkFolder(folderId) {
    const checkboxes = document.querySelectorAll('.bgm-item-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast("선택된 BGM이 없습니다.");
        return;
    }
    let count = 0;
    checkboxes.forEach(cb => {
        const bgmId = cb.value;
        folders.forEach(f => f.bgmIds = f.bgmIds.filter(bid => bid !== bgmId));
        if (folderId) {
            const targetF = folders.find(f => f.id === folderId);
            if (targetF) targetF.bgmIds.push(bgmId);
        }
        const bgm = bgms.find(b => b.id === bgmId);
        if (bgm) bgm.folderId = folderId || null;
        count++;
    });
    saveData();
    renderAll();
    document.getElementById('bulk-select-all').checked = false;
    showToast(`총 ${count}개의 BGM의 소속 폴더를 일괄 변경했습니다.`);
}

function applyBulkPlaylist(playlistId) {
    if (!playlistId) return;
    const checkboxes = document.querySelectorAll('.bgm-item-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast("선택된 BGM이 없습니다.");
        return;
    }
    const targetP = playlists.find(p => p.id === playlistId);
    if (!targetP) return;

    let count = 0;
    checkboxes.forEach(cb => {
        const bgmId = cb.value;
        if (!targetP.bgmIds.includes(bgmId)) {
            targetP.bgmIds.push(bgmId);
            count++;
        }
    });
    saveData();
    renderAll();
    document.getElementById('bulk-select-all').checked = false;
    showToast(`선택 항목 중 ${count}개의 음원을 [${targetP.name}]에 추가 완료했습니다.`);
}

function applyBulkDelete() {
    const checkboxes = document.querySelectorAll('.bgm-item-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast("삭제할 항목이 선택되지 않았습니다.");
        return;
    }

    const targetIds = Array.from(checkboxes).map(cb => cb.value);
    const confirmDelete = confirm(`⚠️ 선택한 ${targetIds.length}개의 BGM을 아카이브 보관함에서 완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`);
    if (!confirmDelete) return;

    try {
        bgms = bgms.filter(b => !targetIds.includes(b.id));
        folders.forEach(f => f.bgmIds = f.bgmIds.filter(bid => !targetIds.includes(bid)));
        playlists.forEach(p => p.bgmIds = p.bgmIds.filter(bid => !targetIds.includes(bid)));
        
        saveData();
        document.getElementById('bulk-select-all').checked = false;
        showToast(`🗑️ 선택한 ${targetIds.length}개의 BGM을 완전히 삭제했습니다.`);
        renderAll();
    } catch (error) {
        console.error(error);
        showToast("삭제 처리 중 오류가 발생했습니다.");
    }
}

function refreshBulkDropdowns() {
    const fSelect = document.getElementById('bulk-folder-select');
    const pSelect = document.getElementById('bulk-playlist-select');
    
    if (fSelect) {
        fSelect.innerHTML = '<option value="">📁 폴더 일괄 지정</option><option value="">폴더 미지정 상태로 해제</option>';
        folders.forEach(f => { fSelect.innerHTML += `<option value="${f.id}">${f.name}</option>`; });
    }

    if (pSelect) {
        pSelect.innerHTML = '<option value="">🎧 플리 일괄 담기</option>';
        playlists.forEach(p => { pSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`; });
    }
}

function setViewMode(mode) {
    viewMode = mode;
    const btnList = document.getElementById('btn-view-list');
    const btnList2 = document.getElementById('btn-view-list2');
    const btnCard = document.getElementById('btn-view-card');
    const scaleCtrl = document.getElementById('card-scale-controller');

    [btnList, btnList2, btnCard].forEach(b => {
        if(b) b.className = "px-2.5 py-1 text-xs font-semibold rounded-md text-gray-500 cursor-pointer whitespace-nowrap";
    });
    if(scaleCtrl) scaleCtrl.classList.add('hidden');

    if (mode === 'list' && btnList) {
        btnList.className = "px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-gray-800 shadow-sm cursor-pointer whitespace-nowrap";
    } else if (mode === 'list2' && btnList2) {
        btnList2.className = "px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-gray-800 shadow-sm cursor-pointer whitespace-nowrap";
    } else if (mode === 'card' && btnCard) {
        btnCard.className = "px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-gray-800 shadow-sm cursor-pointer whitespace-nowrap";
        if(scaleCtrl) scaleCtrl.classList.remove('hidden');
    }
    renderBgmList();
}

function changeCardCols(val) {
    cardCols = parseInt(val);
    const txt = document.getElementById('card-cols-txt');
    if(txt) txt.innerText = val + '개';
    renderBgmList();
}

function setSortMode(mode) {
    sortMode = mode;
    localStorage.setItem('box_sort_mode', mode);
    
    const btnReg = document.getElementById('btn-sort-reg');
    const btnAbc = document.getElementById('btn-sort-abc');
    const btnDrag = document.getElementById('btn-sort-drag');
    
    [btnReg, btnAbc, btnDrag].forEach(b => {
        if(b) b.className = "px-3 py-1 text-xs font-semibold rounded-md text-gray-500 cursor-pointer whitespace-nowrap";
    });
    
    if (mode === 'reg' && btnReg) {
        btnReg.className = "px-3 py-1 text-xs font-semibold rounded-md bg-white text-gray-800 shadow-sm cursor-pointer whitespace-nowrap";
    } else if (mode === 'abc' && btnAbc) {
        btnAbc.className = "px-3 py-1 text-xs font-semibold rounded-md bg-white text-gray-800 shadow-sm cursor-pointer whitespace-nowrap";
    } else if (mode === 'drag' && btnDrag) {
        btnDrag.className = "px-3 py-1 text-xs font-semibold rounded-md bg-white text-gray-800 shadow-sm cursor-pointer whitespace-nowrap";
        showToast("아이템 좌측의 '☰' 핸들 영역을 드래그해서 순서를 변경하세요.");
    }
    renderBgmList();
}

function setFilter(type, id, value) {
    currentFilter.type = type;
    currentFilter.id = id;
    currentFilter.value = value;
    
    document.querySelectorAll('#sidebar-folders > div, #sidebar-playlists > div').forEach(el => {
        el.classList.remove('bg-blue-50/70', 'font-bold', 'text-custom-blue', 'border', 'border-blue-100');
    });

    const titleEl = document.getElementById('list-title');
    const allBtn = document.getElementById('btn-filter-all');

    if(type === 'all') {
        if(titleEl) titleEl.innerText = '전체 BGM 목록';
        if(allBtn) allBtn.className = "w-full text-left text-sm px-3 py-2 rounded-lg block transition-all font-extrabold bg-blue-50 text-custom-blue border border-blue-100 cursor-pointer";
    } else {
        if(allBtn) allBtn.className = "w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-gray-100 block transition-all text-gray-600 font-normal cursor-pointer";
        if(titleEl) {
            if(type === 'folder') titleEl.innerText = `폴더: ${value}`;
            else if(type === 'playlist') titleEl.innerText = `플레이리스트: ${value}`;
            else if(type === 'tag') titleEl.innerText = `태그 필터: #${value}`;
        }
    }

    const selectAll = document.getElementById('bulk-select-all');
    if(selectAll) selectAll.checked = false;
    renderBgmList();
}

function renderAll() {
    const select = document.getElementById('select-target-folder');
    if(select) {
        select.innerHTML = '<option value="">폴더 미지정 상태로 등록</option>';
        folders.forEach(f => { select.innerHTML += `<option value="${f.id}">${f.name}</option>`; });
    }

    const countEl = document.getElementById('sidebar-all-count');
    if(countEl) countEl.innerText = bgms.length;

    const folderBox = document.getElementById('sidebar-folders');
    if(folderBox) {
        folderBox.innerHTML = '';
        if(folders.length === 0) folderBox.innerHTML = '<p class="text-[11px] text-gray-400 p-2 text-center w-full">폴더가 없습니다.</p>';
        folders.forEach(f => {
            const isSelected = (currentFilter.type === 'folder' && currentFilter.id === f.id);
            folderBox.innerHTML += `
                <div class="flex justify-between items-center group px-2 py-1 rounded-lg transition-colors hover:bg-gray-50 w-full overflow-hidden ${isSelected?'bg-blue-50/70 text-custom-blue font-bold border border-blue-100':''}">
                    <button onclick="setFilter('folder', '${f.id}', '${f.name}')" class="text-xs truncate text-left flex-1 cursor-pointer py-0.5 whitespace-nowrap min-w-0 pr-1">
                        📁 ${f.name} <span class="text-[10px] text-gray-400 font-normal">(${f.bgmIds.length})</span>
                    </button>
                    <div class="flex gap-1.5 items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onclick="renameContainer('folder', '${f.id}', '${f.name}', event)" class="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer px-0.5" title="이름 수정">✏️</button>
                        <button onclick="deleteContainer('folder', '${f.id}', event)" class="text-[9px] text-gray-400 hover:text-rose-600 cursor-pointer px-0.5" title="폴더 해제 및 삭제">❌</button>
                    </div>
                </div>`;
        });
    }

    const playlistBox = document.getElementById('sidebar-playlists');
    if(playlistBox) {
        playlistBox.innerHTML = '';
        if(playlists.length === 0) playlistBox.innerHTML = '<p class="text-[11px] text-gray-400 p-2 text-center w-full">생성된 플리가 없습니다.</p>';
        playlists.forEach(p => {
            const isSelected = (currentFilter.type === 'playlist' && currentFilter.id === p.id);
            playlistBox.innerHTML += `
                <div class="flex justify-between items-center group px-2 py-1 rounded-lg transition-colors hover:bg-gray-50 w-full overflow-hidden ${isSelected?'bg-blue-50/70 text-custom-blue font-bold border border-blue-100':''}">
                    <button onclick="setFilter('playlist', '${p.id}', '${p.name}')" class="text-xs truncate text-left flex-1 cursor-pointer py-0.5 whitespace-nowrap min-w-0 pr-1">
                        🎧 ${p.name} <span class="text-[10px] text-gray-400 font-normal">(${p.bgmIds.length})</span>
                    </button>
                    <div class="flex gap-1.5 items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onclick="renameContainer('playlist', '${p.id}', '${p.name}', event)" class="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer px-0.5" title="이름 수정">✏️</button>
                        <button onclick="deleteContainer('playlist', '${p.id}', event)" class="text-[9px] text-gray-400 hover:text-rose-600 cursor-pointer px-0.5" title="플레이리스트 해제 및 삭제">❌</button>
                    </div>
                </div>`;
        });
    }

    refreshBulkDropdowns();
    renderTagCloud();
    setSortMode(sortMode);
}

function renderTagCloud() {
    const tagContainer = document.getElementById('sidebar-tags');
    if(!tagContainer) return;
    tagContainer.innerHTML = '';
    
    let allTagsMap = {};
    bgms.forEach(b => { b.tags.forEach(t => { allTagsMap[t] = (allTagsMap[t] || 0) + 1; }); });

    const tagKeys = Object.keys(allTagsMap);
    if(tagKeys.length === 0) {
        tagContainer.innerHTML = '<p class="text-[11px] text-gray-400 p-2 text-center w-full">등록된 태그가 없습니다.</p>';
        return;
    }

    tagKeys.forEach(tag => {
        const count = allTagsMap[tag];
        const isSelected = (currentFilter.type === 'tag' && currentFilter.value === tag);
        tagContainer.innerHTML += `
            <button onclick="setFilter('tag', null, '${tag}')" class="text-[10px] px-2 py-0.5 rounded-md font-semibold border transition-all cursor-pointer whitespace-nowrap ${isSelected?'bg-custom-blue text-white border-custom-blue':'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}">
                #${tag} (${count})
            </button>
        `;
    });
}

function deleteContainer(type, id, event) {
    if(event) event.stopPropagation();
    
    if(type === 'folder') {
        if(!confirm('선택하신 폴더 그룹을 해제하고 정말로 삭제하시겠습니까?\n(폴더 내부의 BGM 음악 파일들은 유실되지 않고 안전하게 보존됩니다.)')) return;
        folders = folders.filter(f => f.id !== id);
        bgms.forEach(b => { 
            if(b.folderId === id) b.folderId = null; 
        });
        showToast('📁 폴더가 해제되었으며 내부 BGM은 유지됩니다.');
    } else if(type === 'playlist') {
        if(!confirm('선택하신 플레이리스트를 해제하고 정말로 삭제하시겠습니까?\n(플레이리스트 내부의 BGM 음악 파일들은 유실되지 않고 안전하게 보존됩니다.)')) return;
        playlists = playlists.filter(p => p.id !== id);
        showToast('🎧 플레이리스트가 해제되었으며 내부 BGM은 유지됩니다.');
    }
    
    currentFilter.type = 'all'; 
    currentFilter.id = null;
    saveData(); 
    renderAll();
}

function renderBgmList() {
    const listContainer = document.getElementById('bgm-list');
    if(!listContainer) return;
    const searchKeyword = document.getElementById('search-input') ? document.getElementById('search-input').value.toLowerCase() : '';
    
    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }

    listContainer.innerHTML = '';
    listContainer.style.gridTemplateColumns = '';

    let targetList = [];
    if(currentFilter.type === 'all') {
        targetList = [...bgms];
    } else if(currentFilter.type === 'folder') {
        targetList = bgms.filter(b => b.folderId === currentFilter.id);
    } else if(currentFilter.type === 'playlist') {
        const pl = playlists.find(p => p.id === currentFilter.id);
        if(pl) targetList = pl.bgmIds.map(bid => bgms.find(b => b.id === bid)).filter(Boolean);
    } else if(currentFilter.type === 'tag') {
        targetList = bgms.filter(b => b.tags.includes(currentFilter.value));
    }

    if (sortMode === 'abc') {
        targetList.sort((a, b) => a.customTitle.localeCompare(b.customTitle, 'ko'));
    }

    if(searchKeyword) {
        targetList = targetList.filter(b => 
            b.customTitle.toLowerCase().includes(searchKeyword) ||
            b.realTitle.toLowerCase().includes(searchKeyword) ||
            b.memo.toLowerCase().includes(searchKeyword) ||
            b.tags.some(t => t.toLowerCase().includes(searchKeyword))
        );
    }

    const bgmCountEl = document.getElementById('bgm-count');
    if(bgmCountEl) bgmCountEl.innerText = targetList.length + '개';

    if(targetList.length === 0) {
        listContainer.className = "w-full text-center py-16 text-gray-400 text-sm";
        listContainer.innerHTML = '조건에 일치하는 보관음원이 없습니다.';
        return;
    }

    if (viewMode === 'list') {
        listContainer.className = "space-y-3 w-full block";
        targetList.forEach(bgm => { listContainer.innerHTML += buildListItemHTML(bgm); });
    } else if (viewMode === 'list2') {
        listContainer.className = "grid grid-cols-1 lg:grid-cols-2 gap-4 w-full";
        targetList.forEach(bgm => { listContainer.innerHTML += buildListItemHTML(bgm); });
    } else {
        listContainer.className = `grid gap-4 w-full`;
        listContainer.style.gridTemplateColumns = `repeat(${cardCols}, minmax(0, 1fr))`;
        targetList.forEach(bgm => { listContainer.innerHTML += buildCardItemHTML(bgm); });
    }

    if (sortMode === 'drag') {
        sortableInstance = new Sortable(listContainer, {
            animation: 200,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            handle: '.drag-handle', 
            filter: "input, select, button, iframe, a, .bgm-item-checkbox",
            preventOnFilter: false,
            onEnd: function () {
                const currentOrderIds = Array.from(listContainer.querySelectorAll('[data-bgm-id]')).map(el => el.getAttribute('data-bgm-id'));
                
                if (currentFilter.type === 'all') {
                    const reorderedBgms = [];
                    currentOrderIds.forEach(id => {
                        const found = bgms.find(b => b.id === id);
                        if (found) reorderedBgms.push(found);
                    });
                    bgms.forEach(b => {
                        if (!reorderedBgms.some(rb => rb.id === b.id)) reorderedBgms.push(b);
                    });
                    bgms = reorderedBgms;
                } else if (currentFilter.type === 'playlist') {
                    const pl = playlists.find(p => p.id === currentFilter.id);
                    if (pl) {
                        pl.bgmIds = currentOrderIds;
                    }
                } else if (currentFilter.type === 'folder') {
                    const folder = folders.find(f => f.id === currentFilter.id);
                    if (folder) {
                        folder.bgmIds = currentOrderIds;
                    }
                }
                
                saveData();
                showToast("정렬 순서가 보관함에 즉시 반영되었습니다.");
            }
        });
    }
}

function buildSelectsHTML(bgm) {
    let folderOptions = `<option value="">폴더 선택</option>`;
    folders.forEach(f => { folderOptions += `<option value="${f.id}" ${bgm.folderId === f.id ? 'disabled' : ''}>${f.name}</option>`; });
    let playlistOptions = `<option value="">플리 담기</option>`;
    playlists.forEach(p => { playlistOptions += `<option value="${p.id}">+ ${p.name}</option>`; });

    return `
        <select onclick="event.stopPropagation()" onchange="if(this.value) moveBgmToContainer('${bgm.id}', 'folder', this.value, event)" class="bg-gray-50 text-[11px] text-gray-500 rounded border border-gray-200 p-1 focus:outline-none flex-1 min-w-[70px] max-w-[100px] truncate cursor-pointer">
            ${folderOptions}
        </select>
        <select onclick="event.stopPropagation()" onchange="if(this.value) moveBgmToContainer('${bgm.id}', 'playlist', this.value, event); this.value='';" class="bg-gray-50 text-[11px] text-gray-500 rounded border border-gray-200 p-1 focus:outline-none flex-1 min-w-[70px] max-w-[100px] truncate cursor-pointer">
            ${playlistOptions}
        </select>
    `;
}

function buildListItemHTML(bgm) {
    const tagBadges = bgm.tags.map(t => `<span class="bg-gray-100 text-gray-600 text-[10px] font-semibold px-2 py-0.5 rounded whitespace-nowrap">#${t}</span>`).join(' ');
    const folderObj = folders.find(f => f.id === bgm.folderId);
    const plObjects = playlists.filter(p => p.bgmIds.includes(bgm.id));

    let groupBadgesHtml = '';
    if(folderObj) {
        groupBadgesHtml += `<span class="bg-gray-100 text-gray-600 text-[10px] px-1.5 py-0.5 rounded border border-gray-200 font-bold whitespace-nowrap">📁 ${folderObj.name}</span>`;
    }
    if(plObjects.length > 0) {
        plObjects.forEach(p => {
            groupBadgesHtml += `<span class="bg-gray-100 text-gray-600 text-[10px] px-1.5 py-0.5 rounded border border-gray-200 font-bold whitespace-nowrap">🎧 ${p.name}</span>`;
        });
    }

    const escapedTitle = bgm.customTitle.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');

    let actionBtnHtml = '';
    if (currentFilter.type === 'folder') {
        actionBtnHtml = `
            <button onclick="excludeBgmFromTarget('${bgm.id}', 'folder', '${currentFilter.id}', event)" title="이 폴더에서 제외" class="bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-xs px-2.5 py-1 rounded transition-colors font-medium cursor-pointer whitespace-nowrap min-w-[45px] text-center">
                제외
            </button>`;
    } else if (currentFilter.type === 'playlist') {
        actionBtnHtml = `
            <button onclick="excludeBgmFromTarget('${bgm.id}', 'playlist', '${currentFilter.id}', event)" title="이 플레이리스트에서 제외" class="bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-xs px-2.5 py-1 rounded transition-colors font-medium cursor-pointer whitespace-nowrap min-w-[45px] text-center">
                제외
            </button>`;
    } else {
        actionBtnHtml = `
            <button onclick="deleteBgmDirect('${bgm.id}', '${escapedTitle}', event)" title="보관함에서 즉시 삭제" class="bg-red-50 hover:bg-rose-100 border border-red-200 text-rose-600 text-xs px-2.5 py-1 rounded transition-colors font-medium cursor-pointer whitespace-nowrap min-w-[45px] text-center">
                삭제
            </button>`;
    }

    return `
        <div data-bgm-id="${bgm.id}" onclick="openBgmModal('${bgm.id}')" class="bg-white px-4 py-4 rounded-xl border border-gray-200 hover:border-custom-blue hover:shadow-xs transition-all cursor-pointer flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 group w-full min-w-0">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <input type="checkbox" value="${bgm.id}" onclick="event.stopPropagation()" class="bgm-item-checkbox w-4 h-4 rounded text-custom-blue focus:ring-custom-blue border-gray-300 cursor-pointer shrink-0">
                
                <div class="flex-1 min-w-0 space-y-2">
                    <div class="flex items-center gap-2 flex-wrap min-w-0">
                        ${sortMode === 'drag' ? '<span class="text-gray-400 text-base drag-handle px-1 select-none mr-1">☰</span>' : ''}
                        <h3 class="font-bold text-gray-800 text-sm group-hover:text-custom-blue transition-colors truncate max-w-full sm:max-w-[70%]">${bgm.customTitle}</h3>
                        <div class="flex gap-1 flex-wrap">${tagBadges}</div>
                    </div>
                    
                    <p class="text-[11px] text-gray-400 truncate">원본: ${bgm.realTitle}</p>
                    
                    <div class="flex flex-wrap items-center gap-1.5">
                        ${groupBadgesHtml || '<span class="text-[10px] text-gray-300">지정된 소속 그룹 없음</span>'}
                    </div>
                    
                    ${bgm.memo ? `<p class="text-[11px] text-gray-500 bg-gray-50 px-2 py-0.5 rounded border border-gray-100 inline-block truncate max-w-full">💬 ${bgm.memo}</p>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0 sm:ml-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-gray-100">
                <div class="flex gap-1 items-center w-[150px] sm:w-[170px]">${buildSelectsHTML(bgm)}</div>
                <button onclick="copyLink('${bgm.youtubeUrl}', event)" class="bg-gray-100 hover:bg-custom-blue hover:text-white text-gray-600 text-xs px-2.5 py-1 rounded transition-colors font-medium cursor-pointer whitespace-nowrap min-w-[45px] text-center">복사</button>
                ${actionBtnHtml}
            </div>
        </div>`;
}

function buildCardItemHTML(bgm) {
    const tagBadges = bgm.tags.map(t => `<span class="bg-gray-50 text-gray-600 text-[10px] font-semibold px-1 py-0.5 rounded border border-gray-100 truncate max-w-[70px] inline-block">#${t}</span>`).join(' ');
    const escapedTitle = bgm.customTitle.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');

    let actionBtnHtml = '';
    if (currentFilter.type === 'folder') {
        actionBtnHtml = `
            <button onclick="excludeBgmFromTarget('${bgm.id}', 'folder', '${currentFilter.id}', event)" title="이 폴더에서 제외" class="bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-[11px] p-1 rounded cursor-pointer font-medium text-center whitespace-nowrap flex-1 truncate">
                제외
            </button>`;
    } else if (currentFilter.type === 'playlist') {
        actionBtnHtml = `
            <button onclick="excludeBgmFromTarget('${bgm.id}', 'playlist', '${currentFilter.id}', event)" title="이 플레이리스트에서 제외" class="bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-[11px] p-1 rounded cursor-pointer font-medium text-center whitespace-nowrap flex-1 truncate">
                제외
            </button>`;
    } else {
        actionBtnHtml = `
            <button onclick="deleteBgmDirect('${bgm.id}', '${escapedTitle}', event)" title="보관함에서 즉시 삭제" class="bg-red-50 hover:bg-rose-100 border border-red-200 text-rose-600 text-[11px] p-1 rounded cursor-pointer font-medium text-center whitespace-nowrap flex-1 truncate">
                삭제
            </button>`;
    }

    return `
        <div data-bgm-id="${bgm.id}" onclick="openBgmModal('${bgm.id}')" class="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-custom-blue hover:shadow-md transition-all cursor-pointer flex flex-col group">
            <div class="w-full aspect-video bg-gray-100 relative overflow-hidden border-b border-b-gray-100">
                <img src="${getYoutubeThumbnail(bgm.youtubeId)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" alt="섬네일" loading="lazy">
                <div class="absolute top-2 left-2 z-10" onclick="event.stopPropagation()">
                    <input type="checkbox" value="${bgm.id}" class="bgm-item-checkbox w-4 h-4 rounded text-custom-blue focus:ring-custom-blue border-gray-300 shadow-md cursor-pointer">
                </div>
                <div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="bg-white text-gray-800 font-bold text-[10px] px-2.5 py-1 rounded-full shadow-md flex items-center gap-1">
                        ${sortMode === 'drag' ? '<span class="drag-handle text-xs font-black">☰ 드래그 핸들</span>' : '상세 플레이'}
                    </span>
                </div>
            </div>
            <div class="p-2.5 flex-1 flex flex-col justify-between gap-2 min-w-0">
                <div class="min-w-0 space-y-1">
                    <h3 class="font-bold text-gray-800 text-xs group-hover:text-custom-blue truncate">${bgm.customTitle}</h3>
                    <p class="text-[10px] text-gray-400 truncate">원본: ${bgm.realTitle}</p>
                    <div class="flex flex-wrap gap-0.5 pt-0.5 overflow-hidden max-h-5">${tagBadges}</div>
                    ${bgm.memo ? `<p class="text-[10px] text-gray-500 bg-gray-50 p-1 rounded border border-gray-100 truncate mt-1">💬 ${bgm.memo}</p>` : ''}
                </div>
                <div class="pt-2 border-t border-gray-100 flex items-center gap-1 mt-auto w-full">
                    ${buildSelectsHTML(bgm)}
                    <button onclick="copyLink('${bgm.youtubeUrl}', event)" class="bg-gray-50 hover:bg-custom-blue hover:text-white text-gray-500 text-[11px] p-1 rounded cursor-pointer font-medium text-center border border-gray-200 whitespace-nowrap flex-1 truncate">복사</button>
                    ${actionBtnHtml}
                </div>
            </div>
        </div>`;
}

function showToast(msg) {
    const el = document.getElementById('toast'); 
    if(!el) return;
    el.innerText = msg;
    el.classList.remove('opacity-0', 'pointer-events-none');
    setTimeout(() => { el.classList.add('opacity-0', 'pointer-events-none'); }, 2200);
}

// 최초 화면 로드 및 렌더링 시작
document.addEventListener('DOMContentLoaded', () => {
    renderAll();
});

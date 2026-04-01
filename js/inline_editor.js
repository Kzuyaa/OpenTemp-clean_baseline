document.addEventListener('DOMContentLoaded', () => {
    console.log('OpenTemp: Editor Loading...');
    
    // --- 🏆 CORE STATE (Shared Scope) ---
    let selectedElement = null;
    let activeTab = 'themes';
    let isSidebarCollapsed = false;
    let isResizing = false;
    let isDraggingNode = false;
    let currentHandle = null;
    let startX, startY, startWidth, startHeight;
    let dragOffsetX, dragOffsetY;
    let dragStartStyle, resizeStartStyle;
    let absTop, absLeft; // SHARED: Anchor points for Inspector/Resizer movement
    let lastSwapTime = 0;
    let followerActive = false;
    let iframeObserver = null;
    let templateStyleBackup = {}; // ATOMIC RESTORE: Pure template state storage
    let editAbortController = null; // SHARED: Manage interaction cleanup


    // Self-load template.json — works both standalone and inside factory iframe.
    // Runs immediately on init; by the time user opens any tab it's resolved.
    if (!window.otTemplateConfig) {
        fetch('./template.json')
            .then(r => r.ok ? r.json() : null)
            .then(cfg => {
                if (!cfg) return;
                window.otTemplateConfig = cfg;
                resolvePlaceholders(cfg);
            })
            .catch(() => {});
    } else {
        // Config already injected by factory — still resolve any remaining placeholders
        resolvePlaceholders(window.otTemplateConfig);
    }

    // Replaces {{texts.xxx}} / {{images.xxx}} etc. inside each field's target element.
    // Uses per-element innerHTML replacement so no event listeners are destroyed.
    function resolvePlaceholders(cfg) {
        if (!cfg || !Array.isArray(cfg.fields)) return;
        cfg.fields.forEach(field => {
            if (!field.targetSelector) return;
            try {
                const el = document.querySelector(field.targetSelector);
                if (!el) return;
                const val = localStorage.getItem(field.id) || field.default || '';
                if (!val) return;
                // Update href attribute if present (e.g. <a href="{{...}}">)
                if (el.hasAttribute('href') && el.getAttribute('href').includes('{{')) {
                    el.setAttribute('href', el.getAttribute('href').replace(/\{\{[^}]*\}\}/g, val));
                }
                // Update innerHTML if it contains placeholders
                if (el.innerHTML.includes('{{')) {
                    el.innerHTML = el.innerHTML.replace(/\{\{[^}]*\}\}/g, val);
                }
            } catch (e) {}
        });
    }

    // Safe cross-document getComputedStyle helper
    function getCS(el) {
        try {
            const win = el.ownerDocument.defaultView || window;
            return win.getComputedStyle(el);
        } catch(e) {
            return window.getComputedStyle(el);
        }
    }

    function rgbToHex(rgb) {
        if (!rgb || rgb.startsWith('transparent') || rgb === 'rgba(0, 0, 0, 0)') return '#ffffff';
        const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (!match) {
            const rgbaMatch = rgb.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
            if (rgbaMatch) return "#" + ("0" + parseInt(rgbaMatch[1],10).toString(16)).slice(-2) + ("0" + parseInt(rgbaMatch[2],10).toString(16)).slice(-2) + ("0" + parseInt(rgbaMatch[3],10).toString(16)).slice(-2);
            return '#ffffff';
        }
        function hex(x) { return ("0" + parseInt(x,10).toString(16)).slice(-2); }
        return "#" + hex(match[1]) + hex(match[2]) + hex(match[3]);
    }

    // --- 🏆 THEME PATH PREFIX ---
    // factory:  script is "../../js/inline_editor.js" → prefix = "../../"
    // exported ZIP root: script is "js/inline_editor.js" → prefix = ""
    const otThemePrefix = (() => {
        try {
            const scripts = document.querySelectorAll('script[src*="inline_editor.js"]');
            for (const s of scripts) {
                const src = s.getAttribute('src') || '';
                const matches = src.match(/\.\.\//g);
                return matches ? '../'.repeat(matches.length) : '';
            }
        } catch(e) {}
        return '';
    })();

    // --- 🏆 THEME RESTORE ON LOAD ---
    (function restoreThemeOnLoad() {
        const saved = localStorage.getItem('open-temp-selected-theme');
        if (!saved) return;
        // Always use a <link> element so href changes actually load CSS files.
        // If #theme-css is currently a <style> (inlined by ZIP export), replace it.
        let link = document.getElementById('theme-css');
        if (!link || link.tagName !== 'LINK') {
            if (link) link.remove();
            link = document.createElement('link');
            link.rel  = 'stylesheet';
            link.id   = 'theme-css';
            document.head.appendChild(link);
        }
        link.setAttribute('href', otThemePrefix + saved);
    })();

    // --- 🏆 AGGRESSIVE RE-LOAD & CLEANUP ---
    const cleanUI = () => {
        document.querySelectorAll('#inline-editor-toolbar, #inline-editor-sidebar, #dev-ide-drawer-floating, #ot-code-panel, #inline-selection-box, #inline-element-inspector').forEach(el => el.remove());
        window.isEditing = false;
        document.body.classList.remove('editing');
    };

    cleanUI();
    
    // We update the flag to signal this version is active.
    window.__OpenTempLoaded = true;

    // --- 🏆 STANDALONE MODE DETECTION ---
    window.isStandalone = (window === window.parent);
    console.log(`OpenTemp: Running in ${window.isStandalone ? 'STANDALONE' : 'FACTORY'} mode.`);
    
    // --- 🏆 PREMIUM UI STYLES (Architect Edition) ---
    const injectPremiumCSS = () => {
        if (document.getElementById('ot-premium-ui-styles')) return;
        const style = document.createElement('style');
        style.id = 'ot-premium-ui-styles';
        style.innerHTML = `
            #inline-editor-sidebar { background: rgba(14, 14, 20, 0.95) !important; backdrop-filter: blur(16px) !important; border: 1px solid rgba(255,255,255,0.06) !important; box-shadow: -10px 0 40px rgba(0,0,0,0.6) !important; }
            .section-label { font-size: 0.6rem; color: #666; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; display: block; border-left: 2px solid #FF4500; padding-left: 8px; }
            .edit-group { background: rgba(255,255,255,0.02); padding: 16px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.03); margin-bottom: 16px; transition: 0.2s; }
            .edit-group:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); }
            
            /* Custom Range Sliders */
            .ot-range { -webkit-appearance: none; width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; outline: none; margin: 15px 0; }
            .ot-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; background: #FF4500; border-radius: 50%; cursor: pointer; box-shadow: 0 0 10px rgba(255,69,0,0.4); border: 2px solid #fff; transition: 0.2s; }
            .ot-range::-webkit-slider-thumb:hover { transform: scale(1.2); }
            
            .slider-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
            .slider-label { font-size: 0.7rem; color: #a1a1aa; font-weight: 600; }
            .slider-val { font-size: 0.7rem; color: #FF4500; font-family: monospace; font-weight: 800; background: rgba(255,69,0,0.1); padding: 2px 6px; border-radius: 4px; }
            
            .typography-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 15px; }
            .typography-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px 5px; border-radius: 10px; cursor: pointer; transition: 0.2s; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; }
            .typography-btn:hover { background: rgba(255,255,255,0.1); border-color: #FF4500; }
            .typography-btn.active { background: #FF4500; border-color: #FF4500; }
            
            /* INTERACTION GUARDS */
            body.ot-is-interacting { cursor: grabbing !important; user-select: none !important; -webkit-user-select: none !important; }
            body.ot-is-interacting * { pointer-events: none !important; user-select: none !important; }
            body.ot-is-interacting #inline-selection-box,
            body.ot-is-interacting #inline-selection-box *,
            body.ot-is-interacting #inline-editor-toolbar,
            body.ot-is-interacting #inline-editor-toolbar *,
            body.ot-is-interacting #inline-drag-global-overlay { pointer-events: auto !important; }

            /* RESIZE HANDLE — hover & active affordance */
            #inline-resize-handle {
                transition: transform 0.15s ease, box-shadow 0.15s ease;
                display: flex; align-items: center; justify-content: center;
            }
            #inline-resize-handle:hover {
                transform: scale(1.35);
                box-shadow: 0 0 14px rgba(255,69,0,0.7) !important;
            }
            body.ot-is-interacting #inline-resize-handle {
                transform: scale(1.15);
                cursor: se-resize !important;
            }
        `;
        document.head.appendChild(style);
    };
    injectPremiumCSS();

    // --- 🏆 CORE UI INITIALIZATION (UNIQUE NAMESPACES) ---
    var otSelectionTag = document.createElement('div');
    otSelectionTag.id = 'resizer-selection-tag';
    otSelectionTag.style.cssText = 'position:absolute; top:-20px; left:-2px; background:#FF4500; color:white; padding:2px 8px; font-size:10px; font-weight:bold; border-radius:4px 4px 0 0; text-transform:uppercase; white-space:nowrap;';

    var otResizerBox = document.createElement('div');
    otResizerBox.id = 'inline-selection-box';
    otResizerBox.style.cssText = 'position:absolute; display:none; border:2px solid #FF4500; pointer-events:none; z-index:10000; box-sizing:border-box; transition:box-shadow 0.2s; box-shadow: 0 0 15px rgba(255, 69, 0, 0.2);';
    otResizerBox.appendChild(otSelectionTag);

    var otDragBar = document.createElement('div');
    otDragBar.id = 'inline-selection-drag-handle';
    otDragBar.style.cssText = 'position:absolute; top:-32px; left:0; right:0; height:32px; background:#FF4500; color:#FFF; font-size:11px; font-weight:800; padding:0 12px; border-radius:8px 8px 0 0; pointer-events:auto; cursor:grab; font-family:sans-serif; display:flex; align-items:center; gap:8px; box-shadow: 0 -4px 10px rgba(0,0,0,0.2);';
    otDragBar.innerHTML = '<span style="font-size:18px; line-height:1;">⠿</span> <span style="letter-spacing:1px; text-transform:uppercase;">MOVE ELEMENT</span>';
    otResizerBox.appendChild(otDragBar);

    var otResizeHandle = document.createElement('div');
    otResizeHandle.id = 'inline-resize-handle';
    // 22×22px — big enough for new users; ⤡ icon makes purpose obvious
    otResizeHandle.style.cssText = 'position:absolute; bottom:-11px; right:-11px; width:22px; height:22px; background:#FF4500; border:2px solid #fff; border-radius:50%; cursor:se-resize; pointer-events:auto; box-shadow:0 0 8px rgba(0,0,0,0.5); z-index:10002; font-size:11px; line-height:1; color:#fff; user-select:none;';
    otResizeHandle.innerHTML = '⤡';
    otResizerBox.appendChild(otResizeHandle);

    var otSizeLabel = document.createElement('div');
    otSizeLabel.id = 'inline-size-label';
    otSizeLabel.style.cssText = 'position:absolute; bottom:-34px; right:0; background:rgba(0,0,0,0.85); color:#fff; font-size:10px; font-family:monospace; padding:4px 8px; border-radius:6px; display:none; pointer-events:none; white-space:nowrap; border:1px solid rgba(255,255,255,0.1);';
    otResizerBox.appendChild(otSizeLabel);

    let isBoxResizing = false;
    let resizeStartX, resizeStartY, resizeStartWidth, resizeStartHeight, originalResizeCss;
    
    otResizeHandle.addEventListener('mousedown', (e) => {
        if (!selectedElement) return;
        e.preventDefault(); e.stopPropagation();
        isBoxResizing = true;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        const rect = selectedElement.getBoundingClientRect();
        resizeStartWidth  = rect.width;
        resizeStartHeight = rect.height;
        originalResizeCss = selectedElement.style.cssText;
        // Lock: stop observer so mid-resize mutations don't queue a snapshot
        stopGlobalObserver();
        document.body.classList.add('ot-is-interacting');
        otSizeLabel.style.display = 'block';
        otSizeLabel.innerText = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
        document.addEventListener('mousemove', handleBoxResize);
        document.addEventListener('mouseup', handleBoxResizeEnd);
    });

    // Element-type classifier — drives resize behaviour
    function _resizeCategory(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'img') return 'image';
        if (['h1','h2','h3','h4','h5','h6','p','span','li','a','button','label','td','th'].includes(tag)) return 'text';
        return 'block'; // div, section, article, figure …
    }

    function handleBoxResize(e) {
        if (!isBoxResizing || !selectedElement) return;
        const dx = e.clientX - resizeStartX;
        const dy = e.clientY - resizeStartY;
        const kind = _resizeCategory(selectedElement);

        if (kind === 'image') {
            // Lock aspect ratio — distorting images confuses new users
            const ratio = resizeStartHeight / (resizeStartWidth || 1);
            const newW = Math.max(20, resizeStartWidth + dx);
            const newH = Math.max(20, Math.round(newW * ratio));
            selectedElement.style.width  = newW + 'px';
            selectedElement.style.height = newH + 'px';
            otSizeLabel.innerText = `${Math.round(newW)} × ${newH}px  🔒`;
        } else if (kind === 'text') {
            // Width-only — setting height on text breaks layout / causes overflow
            const newW = Math.max(60, resizeStartWidth + dx);
            selectedElement.style.width  = newW + 'px';
            selectedElement.style.height = 'auto';
            otSizeLabel.innerText = `↔ ${Math.round(newW)}px`;
        } else {
            // Full two-axis resize for containers
            const newW = Math.max(20, resizeStartWidth + dx);
            const newH = Math.max(20, resizeStartHeight + dy);
            selectedElement.style.width  = newW + 'px';
            selectedElement.style.height = newH + 'px';
            otSizeLabel.innerText = `${Math.round(newW)} × ${Math.round(newH)}`;
        }

        selectedElement.style.flexBasis = 'auto';
        selectedElement.style.maxWidth  = '100%';
        showInspector(selectedElement);
    }

    function handleBoxResizeEnd(e) {
        // Always remove listeners — prevents leaks even on edge-case early flag flip
        document.removeEventListener('mousemove', handleBoxResize);
        document.removeEventListener('mouseup', handleBoxResizeEnd);

        if (!isBoxResizing) {
            resetGlobalInteractionState();
            return;
        }
        isBoxResizing = false;
        otSizeLabel.style.display = 'none';

        // Resume observer before recording so the new snapshot is clean
        startGlobalObserver();

        // User feedback — show final dimensions as a status toast
        if (selectedElement) {
            const w = Math.round(parseFloat(selectedElement.style.width)) || '?';
            const hRaw = selectedElement.style.height;
            const h = hRaw === 'auto' ? 'auto' : (Math.round(parseFloat(hRaw)) || '?') + 'px';
            showStatusToast(`Boyut: ${w}px × ${h}`);
        }

        if (selectedElement && originalResizeCss !== selectedElement.style.cssText) {
            const currentH = getCleanSnapshotHTML();
            if (lastSnapshotHTML && currentH !== lastSnapshotHTML) {
                window.historyManager.record(new SnapshotCommand(lastSnapshotHTML, currentH));
            }
        }

        // Guaranteed cleanup on every exit path
        resetGlobalInteractionState();
    }

    var otInspector = document.createElement('div');
    otInspector.id = 'inline-element-inspector';
    otInspector.style.cssText = 'position:absolute; display:none; background:#1A1A24; border:1px solid rgba(255,255,255,0.08); padding:6px; border-radius:12px; box-shadow:0 8px 25px rgba(0,0,0,0.5); z-index:10001; gap:8px; align-items:center; pointer-events:auto; font-family:sans-serif; backdrop-filter:blur(10px);';
    otInspector.innerHTML = `
        <button id="ins-select-container" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem; transition:0.2s;" title="Select Parent Container">⬆ Parent</button>
        <span style="border-left:1px solid rgba(255,255,255,0.1); height:16px;"></span>
        <button id="ins-size-dn" style="background:#2A2A35; color:#fff; border:none; padding:5px 10px; border-radius:8px; cursor:pointer; font-weight:bold; font-size:0.75rem; transition:0.2s;" title="Decrease Font">A-</button>
        <button id="ins-size-up" style="background:#2A2A35; color:#fff; border:none; padding:5px 10px; border-radius:8px; cursor:pointer; font-weight:bold; font-size:0.75rem; transition:0.2s;" title="Increase Font">A+</button>
        <button id="ins-bold" style="background:#2A2A35; color:#fff; border:none; padding:5px 10px; border-radius:8px; cursor:pointer; font-weight:bold; font-size:0.75rem; transition:0.2s;" title="Toggle Bold">B</button>
        <button id="ins-italic" style="background:#2A2A35; color:#fff; border:none; padding:5px 10px; border-radius:8px; cursor:pointer; font-style:italic; font-size:0.75rem; transition:0.2s;" title="Toggle Italic">I</button>
        <span style="border-left:1px solid rgba(255,255,255,0.1); height:16px;"></span>
        <button id="ins-align-left" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem; transition:0.2s;" title="Align Left">⬅</button>
        <button id="ins-align-center" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem; transition:0.2s;" title="Align Center">⬌</button>
        <button id="ins-align-right" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem; transition:0.2s;" title="Align Right">➡</button>
        <span style="border-left:1px solid rgba(255,255,255,0.1); height:16px;"></span>
        <label style="cursor:pointer; display:flex; align-items:center;" title="Text Color">
            <input type="color" id="ins-color" style="width:24px; height:24px; border:none; padding:0; background:none; cursor:pointer; border-radius:4px;">
        </label>
        <label style="cursor:pointer; display:flex; align-items:center;" title="Background Color">
            <input type="color" id="ins-bg-color" style="width:24px; height:24px; border:none; padding:0; background:none; cursor:pointer; border-radius:4px;">
        </label>
        <span style="border-left:1px solid rgba(255,255,255,0.1); height:16px;"></span>
        <button id="ins-z-up" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.65rem; transition:0.2s;" title="Bring Forward">Z+</button>
        <button id="ins-z-dn" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.65rem; transition:0.2s;" title="Send Backward">Z-</button>
        <span id="ins-upload-sep" style="border-left:1px solid rgba(255,255,255,0.1); height:16px; display:none;"></span>
        <button id="ins-upload" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem; transition:0.2s; display:none;" title="Replace Image">📷</button>
        <span id="ins-link-sep" style="border-left:1px solid rgba(255,255,255,0.1); height:16px; display:none;"></span>
        <label id="ins-link-wrap" style="cursor:pointer; display:none; align-items:center; gap:4px; background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);" title="Hyperlink">
            <span style="font-size:12px;">🔗</span>
            <input type="text" id="ins-link-url" placeholder="Link URL..." style="width:100px; background:none; border:none; color:#fff; font-size: 0.75rem; outline:none; font-family:sans-serif;">
        </label>
        <span id="ins-list-sep" style="border-left:1px solid rgba(255,255,255,0.1); height:16px; display:none;"></span>
        <button id="ins-list-add" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem; transition:0.2s; display:none;" title="Add List Item">+ Item</button>
        <span id="ins-slide-sep" style="border-left:1px solid rgba(255,255,255,0.1); height:16px; display:none;"></span>
        <button id="ins-slide-add" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem; transition:0.2s; display:none;" title="Add Slide">+ Slide</button>
        <span id="ins-video-sep" style="border-left:1px solid rgba(255,255,255,0.1); height:16px; display:none;"></span>
        <button id="ins-video-reset" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem; transition:0.2s; display:none;" title="Reset Video">🔄 Video</button>
        <button id="ins-delete" style="background:#EF4444; color:#fff; border:none; padding:5px 10px; border-radius:8px; cursor:pointer; font-size:0.75rem; transition:0.2s;" title="Delete Block">🗑️</button>
        <span style="border-left:1px solid rgba(255,255,255,0.1); height:16px; margin:0 4px;"></span>
        <button id="ins-undo" style="background:#2A2A35; color:#fff; border:none; padding:5px 8px; border-radius:8px; cursor:pointer; font-size:0.7rem; transition:0.2s;" title="Undo (Ctrl+Z)">↩️</button>
    `;

    // --- 🏆 LINK ENGINE: Safe Propagation ---
    function applyLinkToElement(el, url) {
        if (!el) return;
        const url_clean = url.trim();
        const doc = el.ownerDocument;
        let link = (el.tagName === 'A') ? el : el.closest('a');
        if (url_clean === '') {
            if (link) {
                while (link.firstChild) link.parentNode.insertBefore(link.firstChild, link);
                link.remove();
            }
            return;
        }
        if (link) {
            link.setAttribute('href', url_clean);
        } else {
            const newA = doc.createElement('a');
            newA.setAttribute('href', url_clean);
            newA.style.display = 'contents'; 
            newA.style.textDecoration = 'none';
            newA.style.color = 'inherit';
            el.parentNode.insertBefore(newA, el);
            newA.appendChild(el);
        }
    }

    const linkInput = otInspector.querySelector('#ins-link-url');
    if (linkInput) {
        linkInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedElement) applyLinkToElement(selectedElement, linkInput.value);
                linkInput.blur();
                showInspector(selectedElement);
            }
        });
        linkInput.addEventListener('change', () => {
             if (selectedElement) applyLinkToElement(selectedElement, linkInput.value);
        });
    }

    // --- 🏆 INSPECTOR LOGIC (RESTORED) ---
    otInspector.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || !selectedElement) return;
        const id = btn.id;
        let cmd = null;

        if (id === 'ins-delete') {
            window.historyManager.execute(new DeleteCommand(selectedElement));
            return;
        } else if (id === 'ins-bold') {
            const ov = selectedElement.style.fontWeight || getCS(selectedElement).fontWeight;
            const nv = (ov === 'bold' || ov === '700') ? 'normal' : 'bold';
            cmd = new StyleCommand(selectedElement, 'fontWeight', ov, nv);
        } else if (id === 'ins-italic') {
            const ov = selectedElement.style.fontStyle || getCS(selectedElement).fontStyle;
            const nv = (ov === 'italic') ? 'normal' : 'italic';
            cmd = new StyleCommand(selectedElement, 'fontStyle', ov, nv);
        } else if (id === 'ins-align-left') {
            cmd = new StyleCommand(selectedElement, 'textAlign', selectedElement.style.textAlign || getCS(selectedElement).textAlign, 'left');
        } else if (id === 'ins-align-center') {
            cmd = new StyleCommand(selectedElement, 'textAlign', selectedElement.style.textAlign || getCS(selectedElement).textAlign, 'center');
        } else if (id === 'ins-align-right') {
            cmd = new StyleCommand(selectedElement, 'textAlign', selectedElement.style.textAlign || getCS(selectedElement).textAlign, 'right');
        } else if (id === 'ins-size-up') {
            const fs = parseInt(getCS(selectedElement).fontSize) || 16;
            cmd = new StyleCommand(selectedElement, 'fontSize', fs + 'px', (fs + 2) + 'px');
        } else if (id === 'ins-size-dn') {
            const fs = parseInt(getCS(selectedElement).fontSize) || 16;
            cmd = new StyleCommand(selectedElement, 'fontSize', fs + 'px', Math.max(8, fs - 2) + 'px');
        } else if (id === 'ins-z-up') {
            const zi = parseInt(getCS(selectedElement).zIndex) || 1;
            cmd = new StyleCommand(selectedElement, 'zIndex', zi, zi + 1);
        } else if (id === 'ins-z-dn') {
            const zi = parseInt(getCS(selectedElement).zIndex) || 1;
            cmd = new StyleCommand(selectedElement, 'zIndex', zi, Math.max(0, zi - 1));
        } else if (id === 'ins-undo') {
            window.historyManager.undo();
        } else if (id === 'ins-select-container') {
            const parent = selectedElement.parentElement;
            if (parent && parent.tagName !== 'BODY') {
                selectedElement = parent;
                showInspector(parent);
            }
        }
        
        if (cmd) {
            window.historyManager.execute(cmd);
            // UI STATE ISOLATION: Commands must never switch the active tab.
            // syncSidebarFields() inside StyleCommand/TextEditCommand handles field sync.
        }
    });

    const bindColor = (id, prop) => {
        const input = otInspector.querySelector(id);
        if (input) {
            let oldVal = "";
            input.addEventListener('focus', () => { oldVal = selectedElement.style[prop] || getCS(selectedElement)[prop]; });
            input.addEventListener('input', (e) => {
                if (selectedElement) {
                    selectedElement.style[prop] = e.target.value;
                    // UI STATE ISOLATION: Live color preview must not trigger a tab switch.
                    // The 'change' event below commits to history; 'input' is preview-only.
                }
            });
            input.addEventListener('change', (e) => {
                if (selectedElement && oldVal !== e.target.value) {
                    window.historyManager.execute(new StyleCommand(selectedElement, prop, oldVal, e.target.value));
                }
            });
        }
    };
    bindColor('#ins-color', 'color');
    bindColor('#ins-bg-color', 'backgroundColor');

    var otToolbar = document.createElement('div');
    otToolbar.id = 'inline-editor-toolbar';
    otToolbar.style.cssText = 'position:fixed !important; bottom:24px !important; right:24px !important; z-index:2147483647 !important; display:flex !important; gap:8px !important; align-items:center !important; background:rgba(22, 22, 30, 0.98) !important; backdrop-filter:blur(12px) !important; padding:8px !important; border-radius:24px !important; border:1px solid rgba(255,255,255,0.1) !important; box-shadow:0 8px 32px rgba(0,0,0,0.5) !important; font-family:sans-serif !important; pointer-events:auto !important; visibility:visible !important; opacity:1 !important;';
    otToolbar.innerHTML = `
        <div style="display:flex; background:#111; padding:4px; border-radius:18px; border:1px solid rgba(255,255,255,0.05); gap:2px; pointer-events:auto !important;">
            <button id="btn-mode-preview" style="background:#FF4500; color:#fff; border:none; padding:10px 18px; border-radius:14px; font-weight:700; cursor:pointer !important; pointer-events:auto !important; font-size:0.8rem; transition:0.2s;">👀 Preview</button>
            <button id="btn-mode-edit" style="background:transparent; color:#888; border:none; padding:10px 18px; border-radius:14px; font-weight:700; cursor:pointer !important; pointer-events:auto !important; font-size:0.8rem; transition:0.2s;">📝 Edit</button>
        </div>
        <button id="btn-mode-code" style="background:rgba(0,255,204,0.1); color:#00ffcc; border:1px solid rgba(0,255,204,0.2); padding:10px 18px; border-radius:14px; font-weight:700; cursor:pointer !important; pointer-events:auto !important; font-size:0.8rem; transition:0.2s;">[&lt;/&gt; Code]</button>
        <button id="inline-export-btn" style="background:#FF4500 !important; color:#fff !important; border:none !important; padding:10px 20px !important; border-radius:14px !important; font-weight:800 !important; cursor:pointer !important; pointer-events:auto !important; display:none; align-items:center !important; gap:8px !important; font-size:0.85rem !important; transition:0.2s !important; box-shadow: 0 4px 15px rgba(255,69,0,0.3) !important; border: 1px solid rgba(255,255,255,0.1) !important;">🚀 EXPORT PROJECT</button>
    `;

    setTimeout(() => {
        if (window.isStandalone) {
            const expBtn = otToolbar.querySelector('#inline-export-btn');
            if (expBtn) expBtn.style.setProperty('display', 'flex', 'important');
        }
    }, 100);

    window.exportTemplate = function() {
        if (!window.isStandalone && window.parent.document.getElementById('export-zip-btn')) {
             window.parent.document.getElementById('export-zip-btn').click();
             return;
        }
        const clone = document.documentElement.cloneNode(true);
        const systemIds = [ 'inline-editor-toolbar', 'inline-editor-sidebar', 'inline-selection-box', 'inline-element-inspector', 'inline-drag-global-overlay', 'ot-premium-ui-styles', 'monaco-container' ];
        systemIds.forEach(id => { const el = clone.querySelector(`#${id}`); if (el) el.remove(); });
        clone.querySelectorAll('*').forEach(node => { node.removeAttribute('contenteditable'); node.removeAttribute('spellcheck'); if (node.classList) { node.classList.remove('editing', 'ot-dragging', 'resizer-active', 'ot-selected'); if (node.classList.length === 0) node.removeAttribute('class'); } });
        clone.querySelectorAll('script').forEach(s => { const src = s.getAttribute('src') || ''; if (src.includes('inline_editor.js')) s.remove(); });
        const htmlContent = '<!DOCTYPE html>\n' + clone.outerHTML;
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `opentemp-export-${new Date().getTime()}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    var otDragOverlay = document.createElement('div');
    otDragOverlay.id = 'inline-drag-global-overlay';
    otDragOverlay.style.cssText = 'position:fixed; inset:0; z-index:2147483640; display:none; background:transparent; cursor:grabbing;';
    document.body.appendChild(otDragOverlay);

    var otSidebar = document.createElement('div');
    otSidebar.id = 'inline-editor-sidebar';
    otSidebar.style.cssText = 'position:fixed !important; bottom:0 !important; left:50% !important; width:840px !important; max-width:95% !important; height:410px !important; background:rgba(10, 10, 12, 1) !important; backdrop-filter:blur(20px) !important; border:1px solid rgba(255,255,255,0.15) !important; border-bottom:none !important; border-radius:32px 32px 0 0 !important; box-shadow:0 -20px 80px rgba(0,0,0,0.95) !important; z-index:2147483648 !important; display:flex !important; flex-direction:column !important; padding:0 !important; transform:translateX(-50%) translateY(100%) !important; visibility:hidden !important; color:#fff !important; font-family:sans-serif !important; transition:all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important; pointer-events:auto !important; color-scheme: dark !important;';

    otSidebar.innerHTML = `
        <style>
            #inline-editor-sidebar #panel-content { font-family: 'Inter', 'Segoe UI', sans-serif; color: #fff; line-height: 1.5; }
            #inline-editor-sidebar .edit-group { margin-bottom: 24px; background: rgba(255, 255, 255, 0.03); padding: 18px; border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.05); }
            #inline-editor-sidebar .section-label { display: block; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: #FF4500; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 69, 0, 0.2); }
            #inline-editor-sidebar .slider-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            #inline-editor-sidebar .slider-label { font-size: 0.7rem; font-weight: 700; opacity: 0.6; text-transform: uppercase; }
            #inline-editor-sidebar .slider-val { font-size: 0.75rem; font-weight: 800; color: #FF4500; background: rgba(255, 69, 0, 0.1); padding: 3px 10px; border-radius: 8px; border: 1px solid rgba(255, 69, 0, 0.2); }
            #inline-editor-sidebar .typography-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 15px; }
            #inline-editor-sidebar .typography-btn { aspect-ratio: 1/1; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; color: #fff; font-size: 0.95rem; cursor: pointer; transition: 0.2s; display: flex; align-items: center; justify-content: center; font-weight: bold; }
            #inline-editor-sidebar .typography-btn:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.2); transform: translateY(-3px); }
            #inline-editor-sidebar .typography-btn.active { background: #FF4500 !important; color: #fff !important; border-color: #FF4500 !important; box-shadow: 0 6px 20px rgba(255, 69, 0, 0.4); }
            #inline-editor-sidebar .ot-range { -webkit-appearance: none; width: 100%; height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 3px; outline: none; margin: 18px 0; cursor: pointer; }
            #inline-editor-sidebar .ot-range::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; background: #FF4500; border-radius: 50%; cursor: pointer; box-shadow: 0 0 15px rgba(255, 69, 0, 0.6); border: 2.5px solid #fff; transition: 0.2s; }
            #inline-editor-sidebar input[type="color"].ot-color-input { background: none; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 4px; height: 42px; width: 100%; cursor: pointer; box-sizing: border-box; }
            #inline-editor-sidebar textarea { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; color: #fff; padding: 12px; font-family: inherit; font-size: 0.9rem; resize: vertical; margin-bottom: 15px; }
        </style>
        <div id="sidebar-toggle-btn" style="position: absolute; top: -18px; left: 50%; transform: translateX(-50%); width: 80px; height: 24px; background: rgba(255, 255, 255, 0.15); border-radius: 12px; cursor: pointer; z-index: 100; display: flex; align-items: center; justify-content: center; transition: background 0.2s; pointer-events:auto;"><div style="width: 40px; height: 4px; background: rgba(255,255,255,0.4); border-radius: 4px;"></div></div>
        <div style="display:flex; gap:28px; border-bottom:1px solid rgba(255,255,255,0.08); padding:20px 32px; background:rgba(0,0,0,0.2);">
             <button class="panel-tab active" data-tab="themes" style="background:none; border:none; color:#FF4500; font-weight:800; cursor:pointer; font-size:0.85rem; letter-spacing:0.5px;">🎨 THEMES</button>
             <button class="panel-tab" data-tab="edit" style="background:none; border:none; color:#fff; opacity:0.5; font-weight:800; cursor:pointer; font-size:0.85rem; letter-spacing:0.5px;">✏️ EDIT</button>
             <button class="panel-tab" data-tab="elements" style="background:none; border:none; color:#fff; opacity:0.5; font-weight:800; cursor:pointer; font-size:0.85rem; letter-spacing:0.5px;">+ ELEMENTS</button>
             <button class="panel-tab" data-tab="widgets" style="background:none; border:none; color:#fff; opacity:0.5; font-weight:800; cursor:pointer; font-size:0.85rem; letter-spacing:0.5px;">+ WIDGETS</button>
        </div>
        <div id="panel-content" style="flex:1; overflow-y:auto; padding:24px;"></div>
    `;

    document.body.appendChild(otToolbar);
    document.body.appendChild(otSidebar);
    document.body.appendChild(otResizerBox);
    document.body.appendChild(otInspector);

    const getIframeDoc = () => {
        const iframe = document.getElementById('template-iframe');
        try {
            if (iframe && iframe.contentDocument) return iframe.contentDocument;
            if (iframe && iframe.contentWindow && iframe.contentWindow.document) return iframe.contentWindow.document;
        } catch (e) {
            console.error("OpenTemp: Cannot access iframe document (CORS/file:// policy block).");
            // STRICT SCOPE: A CORS-blocked iframe must never fall through to the parent document.
            // Returning document here would let SnapshotCommand wipe the factory UI.
            return null;
        }
        // An iframe element exists but yielded no document — do not touch parent.
        if (iframe) return null;
        // No iframe element at all: this script IS the template document.
        // Whether standalone (opened directly) or embedded inside the factory's iframe,
        // 'document' here is always the template — never the factory parent page.
        return document;
    };

    const WidgetEngine = {
        registry: {},
        register: function(name, definition) { this.registry[name] = definition; },
        inject: function(widgetName, doc) {
            const widget = this.registry[widgetName];
            if (!widget) return null;
            const instanceId = `widget-${widgetName}-${Math.random().toString(36).substr(2, 6)}`;
            
            const wrapper = doc.createElement('div');
            wrapper.id = instanceId;
            wrapper.className = `ot-widget ot-${widgetName}`;
            wrapper.innerHTML = widget.html(instanceId);
            wrapper.style.cssText = `position: relative !important; display: block !important; width: 100% !important; margin: 20px 0 !important; border-radius: 24px !important; overflow: hidden !important;`;
            
            let styleTag = doc.getElementById('opentemp-shared-styles');
            if (!styleTag) {
                styleTag = doc.createElement('style');
                styleTag.id = 'opentemp-shared-styles';
                doc.head.appendChild(styleTag);
            }
            if (!styleTag.innerHTML.includes(`.ot-${widgetName}`)) {
                styleTag.innerHTML += `\n/* WIDGET: ${widgetName.toUpperCase()} */\n` + widget.css() + `\n`;
            }

            const scriptTag = doc.createElement('script');
            scriptTag.className = 'ot-widget-script';
            scriptTag.text = `(function(){ ${widget.js(instanceId)} })();`;
            doc.body.appendChild(scriptTag);
            
            return wrapper;
        }
    };

    WidgetEngine.register('slider', {
        html: (id) => `
            <div class="slider-track" id="track-${id}" style="display:flex; transition:transform 0.4s ease;">
                <div class="slide" style="min-width:100%;"><img src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800" style="width:100%; height:400px; object-fit:cover;"></div>
                <div class="slide" style="min-width:100%;"><img src="https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800" style="width:100%; height:400px; object-fit:cover;"></div>
            </div>
            <button id="prev-${id}" style="position:absolute; left:20px; top:50%; transform:translateY(-50%); background:rgba(0,0,0,0.6); color:#fff; border:none; width:40px; height:40px; border-radius:50%; cursor:pointer; font-weight:bold;">&#10094;</button>
            <button id="next-${id}" style="position:absolute; right:20px; top:50%; transform:translateY(-50%); background:rgba(0,0,0,0.6); color:#fff; border:none; width:40px; height:40px; border-radius:50%; cursor:pointer; font-weight:bold;">&#10095;</button>`,
        css: () => `.ot-slider { position:relative; overflow:hidden; width:100%; border-radius:32px; background:#000; }`,
        js: (id) => `const track=document.getElementById('track-${id}'); let idx=0; document.getElementById('next-${id}').onclick=()=>{ idx=(idx+1)%track.children.length; track.style.transform='translateX(-'+(idx*100)+'%)'; }; document.getElementById('prev-${id}').onclick=()=>{ idx=(idx-1+track.children.length)%track.children.length; track.style.transform='translateX(-'+(idx*100)+'%)'; };`
    });

    WidgetEngine.register('datatable', {
        html: (id) => `
            <div style="padding:20px; background:rgba(255,255,255,0.03); border-bottom:1px solid rgba(255,255,255,0.1);">
                <input type="text" id="search-${id}" placeholder="Search records..." style="width:100%; background:rgba(0,0,0,0.5); color:#fff; border:1px solid rgba(255,255,255,0.2); padding:10px; border-radius:10px; outline:none;">
            </div>
            <div class="dt-grid" id="grid-${id}" style="display:grid; grid-template-columns: 2fr 2fr 1fr; padding:10px;">
                ${['Name','Role','Status'].map(h=>`<div style="font-weight:bold; padding:12px; opacity:0.6; font-size:0.75rem; text-transform:uppercase; letter-spacing:1px;">${h}</div>`).join('')}
                ${['Alice Visuals','Designer','Active','Bob Architect','Developer','Hold','Charlie Code','Product','Active'].map(d=>`<div class="dt-cell" style="padding:15px 12px; border-top:1px solid rgba(255,255,255,0.05); font-size:0.9rem;">${d}</div>`).join('')}
            </div>`,
        css: () => `.ot-datatable { background:rgba(10,10,12,0.8); border:1px solid rgba(255,255,255,0.1); border-radius:28px; overflow:hidden; backdrop-filter:blur(10px); }`,
        js: (id) => `const input=document.getElementById('search-${id}'); const cells=Array.from(document.querySelectorAll('#grid-${id} .dt-cell')); input.oninput=(e)=>{ const t=e.target.value.toLowerCase(); for(let i=0; i<cells.length; i+=3){ const match=(cells[i].innerText+cells[i+1].innerText+cells[i+2].innerText).toLowerCase().includes(t); cells[i].style.display=cells[i+1].style.display=cells[i+2].style.display=match?'block':'none'; } }`
    });

    // --- 🏆 INTERACTION SAFEGUARDS ---
    // --- 🏆 THE "FREEZE" RECOVERY PROTOCOL ---
    function resetGlobalInteractionState() {
        isDraggingNode = false;
        isResizing = false;
        isBoxResizing = false;
        // ATOMIC ARMOR: Direct closure reference — never fails even if DOM query would
        document.body.classList.remove('ot-is-interacting');
        otDragOverlay.style.display = 'none';

        const doc = getIframeDoc();
        if (doc && doc.body) doc.body.classList.remove('ot-is-interacting');

        // BUTTON LOCK RECOVERY: Force pointer-events on all editor chrome.
        // querySelectorAll catches both elements in one pass — safer than two getElementById
        // calls which could silently miss an element during a DOM mutation.
        document.querySelectorAll('#inline-editor-toolbar, #inline-editor-sidebar').forEach(el => {
            el.style.pointerEvents = 'auto';
        });
    }

    // --- 🏆 COMMAND PATTERN & HISTORY MANAGER ---
    class HistoryManager {
        constructor() {
            this.undoStack = [];
            this.redoStack = [];
            this.isProcessing = false;
        }
        execute(command) {
            if (this.isProcessing) return;
            try {
                this.isProcessing = true;
                stopGlobalObserver(); // 🚀 Hard isolation
                resetGlobalInteractionState();
                command.execute();
                this.undoStack.push(command);
                this.redoStack = [];
                if (this.undoStack.length > 50) this.undoStack.shift();
                
                // 🚀 Sync Mask
                lastSnapshotHTML = getCleanSnapshotHTML();
            } catch(e) { 
                console.error("History Execute Error:", e); 
            } finally {
                // 🚀 Async Unlock: Give browser time to settle DOM microtasks
                setTimeout(() => {
                    this.isProcessing = false;
                    resetAfterHistory();
                }, 10);
            }
        }
        record(command) {
            if (this.isProcessing) return;
            try {
                this.isProcessing = true;
                this.undoStack.push(command);
                this.redoStack = [];
                if (this.undoStack.length > 50) this.undoStack.shift();
                lastSnapshotHTML = getCleanSnapshotHTML();
            } finally {
                setTimeout(() => { this.isProcessing = false; }, 10);
            }
        }
        undo() {
            if (this.undoStack.length === 0 || this.isProcessing) return;
            // ATOMIC ARMOR: Lock immediately — before any async boundary
            this.isProcessing = true;
            resetGlobalInteractionState();
            stopGlobalObserver();
            // Save selection ID before command.undo() can call showInspector(null) and wipe it
            const savedId = lastSelectedId;
            const command = this.undoStack.pop();
            try {
                command.undo();
                this.redoStack.push(command);
            } catch(e) {
                console.error("Undo Error:", e);
                // Restore command — a failed undo must not silently destroy history
                this.undoStack.push(command);
            } finally {
                // Restore saved ID so resetAfterHistory can re-attach to the live DOM node
                lastSelectedId = savedId;
                // 100ms: DOM must settle before observer restarts and isProcessing clears
                setTimeout(() => {
                    this.isProcessing = false;
                    resetGlobalInteractionState();
                    resetAfterHistory();
                }, 100);
            }
        }
        redo() {
            if (this.redoStack.length === 0 || this.isProcessing) return;
            // ATOMIC ARMOR: Lock immediately — before any async boundary
            this.isProcessing = true;
            resetGlobalInteractionState();
            stopGlobalObserver();
            // Save selection ID before command.execute() can call showInspector(null) and wipe it
            const savedId = lastSelectedId;
            const command = this.redoStack.pop();
            try {
                command.execute();
                this.undoStack.push(command);
            } catch(e) {
                console.error("Redo Error:", e);
                // Restore command — a failed redo must not silently destroy history
                this.redoStack.push(command);
            } finally {
                // Restore saved ID so resetAfterHistory can re-attach to the live DOM node
                lastSelectedId = savedId;
                // 100ms: DOM must settle before observer restarts and isProcessing clears
                setTimeout(() => {
                    this.isProcessing = false;
                    resetGlobalInteractionState();
                    resetAfterHistory();
                }, 100);
            }
        }
    }
    window.historyManager = new HistoryManager();

    class SnapshotCommand {
        constructor(oldHTML, newHTML) {
            this.oldHTML = oldHTML;
            this.newHTML = newHTML;
        }
        execute() {
            const doc = getIframeDoc();
            if (doc && doc.body) { 
                doc.body.innerHTML = this.newHTML; 
                selectedElement = null; // 🚀 Clear dead references
                showInspector(null);
                showStatusToast("Redo: Multiple Changes");
            }
        }
        undo() {
            const doc = getIframeDoc();
            if (doc && doc.body) { 
                doc.body.innerHTML = this.oldHTML; 
                selectedElement = null; // 🚀 Clear dead references
                showInspector(null);
                showStatusToast("Undo: Multiple Changes");
            }
        }
    }

    class MoveCommand {
        constructor(element, oldTransform, newTransform) {
            this.element = element;
            this.oldTransform = oldTransform;
            this.newTransform = newTransform;
            this.elementId = element.id;
        }
        execute() {
            this.element.style.transform = this.newTransform;
            showInspector(this.element);
            showStatusToast("Redo: Move");
        }
        undo() {
            this.element.style.transform = this.oldTransform;
            showInspector(this.element);
            showStatusToast("Undo: Move");
        }
    }

    class TextEditCommand {
        constructor(element, oldText, newText) {
            this.element = element;
            this.oldText = oldText;
            this.newText = newText;
        }
        execute() {
            this.element.innerHTML = this.newText;
            showInspector(this.element);
            syncSidebarFields(); // 🚀 Isolated Sync
            showStatusToast("Redo: Text Edit");
        }
        undo() {
            this.element.innerHTML = this.oldText;
            showInspector(this.element);
            syncSidebarFields(); // 🚀 Isolated Sync
            showStatusToast("Undo: Text Edit");
        }
    }

    class StyleCommand {
        constructor(element, property, oldVal, newVal) {
            this.element = element;
            this.property = property;
            this.oldVal = oldVal;
            this.newVal = newVal;
        }
        execute() {
            this.element.style[this.property] = this.newVal;
            showInspector(this.element);
            syncSidebarFields(); // 🚀 Isolated Sync
            showStatusToast(`Redo: ${this.property}`);
        }
        undo() {
            this.element.style[this.property] = this.oldVal;
            showInspector(this.element);
            syncSidebarFields(); // 🚀 Isolated Sync
            showStatusToast(`Undo: ${this.property}`);
        }
    }

    class DeleteCommand {
        constructor(element) {
            this.element = element;
            this.parent = element.parentElement;
            this.nextSibling = element.nextSibling;
        }
        execute() {
            if (this.element) {
                this.element.remove();
                selectedElement = null;
                showInspector(null);
                showStatusToast("Delete: Element Removed");
            }
        }
        undo() {
            if (this.element && this.parent) {
                if (this.nextSibling && this.nextSibling.parentNode === this.parent) {
                    this.parent.insertBefore(this.element, this.nextSibling);
                } else {
                    this.parent.appendChild(this.element);
                }
                showInspector(this.element);
                showStatusToast("Undo: Element Restored");
            }
        }
    }

    function showStatusToast(message) {
        let toast = document.getElementById('ot-status-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ot-status-toast';
            toast.style.cssText = `
                position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
                background: rgba(0,0,0,0.8); color: #fff; padding: 10px 20px;
                border-radius: 99px; font-size: 0.8rem; font-weight: 600;
                z-index: 20000; pointer-events: none; transition: all 0.3s ease;
                opacity: 0; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                border: 1px solid rgba(255,255,255,0.1);
            `;
            document.body.appendChild(toast);
        }
        toast.innerText = message;
        toast.style.opacity = '1';
        toast.style.bottom = '100px';
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.bottom = '80px';
        }, 2000);
    }

    let lastSnapshotHTML = null;
    let lastSelectedId = null; 

    function getCleanSnapshotHTML() {
        try {
            const iframeDoc = getIframeDoc();
            if (!iframeDoc || !iframeDoc.body) return null;
            const clone = iframeDoc.body.cloneNode(true);
            // STRICT SCOPE: Strip all editor system elements from the snapshot.
            // These are injected at runtime and must never enter the content history.
            // If they did, a SnapshotCommand.undo() would restore dead event-listener
            // copies and leave the live JS references pointing to detached nodes.
            ['inline-selection-box', 'inline-element-inspector', 'inline-drag-global-overlay',
             'ot-premium-ui-styles', 'resizer-selection-tag', 'ot-status-toast',
             'inline-editor-toolbar', 'inline-editor-sidebar'].forEach(id => {
                const el = clone.querySelector(`#${id}`);
                if (el) el.remove();
            });
            clone.querySelectorAll('.ot-dragging, .ot-editable-candidate, .ot-selected').forEach(el => {
                el.classList.remove('ot-dragging', 'ot-editable-candidate', 'ot-selected');
                if (el.getAttribute('class') === '') el.removeAttribute('class');
            });
            return clone.innerHTML;
        } catch(e) {
            console.warn("Snapshot capture failed:", e);
            return lastSnapshotHTML;
        }
    }

    function captureSnapshotNow() {
        if (window.historyManager.isProcessing || !window.isEditing) return;
        const currentHTML = getCleanSnapshotHTML();
        if (!currentHTML || currentHTML === lastSnapshotHTML) return;

        if (lastSnapshotHTML !== null) {
            const command = new SnapshotCommand(lastSnapshotHTML, currentHTML);
            window.historyManager.undoStack.push(command);
            window.historyManager.redoStack = [];
        }
        lastSnapshotHTML = currentHTML;
    }

    const globalObserver = new MutationObserver(() => {
        if (window.historyManager.isProcessing) return;
        clearTimeout(window.__snapshotTimer);
        window.__snapshotTimer = setTimeout(() => { if (!isDraggingNode && !isResizing && !isBoxResizing) captureSnapshotNow(); }, 400);
    });

    function startGlobalObserver() {
        const iframe = document.getElementById('template-iframe');
        // STRICT SCOPE: When no template-iframe exists inside this document, we ARE the
        // template document (standalone or embedded). Always use 'document' in that case.
        // The old (window.isStandalone ? document : null) pattern incorrectly returned null
        // in factory/embedded mode, silently preventing the observer from ever starting.
        const doc = (iframe && iframe.contentDocument) ? iframe.contentDocument : document;
        if (doc && doc.body) {
            globalObserver.disconnect();
            globalObserver.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
        }
    }
    function stopGlobalObserver() { globalObserver.disconnect(); }

    function syncSidebarFields() {
        if (activeTab !== 'edit' || !selectedElement) return;
        const panel = document.getElementById('panel-content');
        if (!panel) return;
        
        const cs = getCS(selectedElement);
        
        const textVal = panel.querySelector('#edit-text-val');
        if (textVal) textVal.value = selectedElement.innerHTML;
        
        const fs = parseInt(cs.fontSize) || 16;
        const sizeRange = panel.querySelector('#size-range');
        if (sizeRange) sizeRange.value = fs;
        const fsLabel = panel.querySelector('#fs-val');
        if (fsLabel) fsLabel.innerText = fs + 'px';
        
        const lh = parseFloat(cs.lineHeight) || 1.2;
        const lhRange = panel.querySelector('#lh-range');
        if (lhRange) lhRange.value = lh;
        const lhLabel = panel.querySelector('#lh-val');
        if (lhLabel) lhLabel.innerText = lh;
        
        const pad = parseInt(cs.padding) || 0;
        const padRange = panel.querySelector('#pad-range');
        if (padRange) padRange.value = pad;
        const padLabel = panel.querySelector('#pad-val');
        if (padLabel) padLabel.innerText = pad + 'px';
        
        const br = parseInt(cs.borderRadius) || 0;
        const brRange = panel.querySelector('#br-range');
        if (brRange) brRange.value = br;
        const brLabel = panel.querySelector('#br-val');
        if (brLabel) brLabel.innerText = br + 'px';
        
        const cp = panel.querySelector('#color-pick');
        if (cp) cp.value = rgbToHex(cs.color);
        
        const bcp = panel.querySelector('#bg-color-pick');
        if (bcp) bcp.value = rgbToHex(cs.backgroundColor);
    }

    function reattachSystemElements() {
        // SnapshotCommand.undo/execute replaces doc.body.innerHTML, which silently
        // detaches every system element from the DOM. Their closure references remain
        // valid — re-appending them is safe and instantaneous.
        [otDragOverlay, otInspector, otResizerBox, otSidebar, otToolbar, otCodePanel].forEach(el => {
            if (el && !document.body.contains(el)) document.body.appendChild(el);
        });
    }

    function resetAfterHistory() {
        // Always run first — a SnapshotCommand may have just wiped the DOM.
        reattachSystemElements();
        const doc = getIframeDoc();
        if (doc && lastSelectedId) {
            const recovered = doc.getElementById(lastSelectedId);
            if (recovered) {
                selectedElement = recovered;
                showInspector(recovered);
                // UI STATE ISOLATION: Never call loadTab() here.
                // loadTab() changes activeTab and re-renders the whole panel, which is what
                // causes the visible tab switch on every Ctrl+Z. The user's tab choice is
                // their own state — undo/redo must not override it.
                // syncSidebarFields() updates the current panel's values without tab switching.
                if (activeTab === 'edit') syncSidebarFields();
            } else {
                selectedElement = null;
                otInspector.style.display = 'none';
                if (otResizerBox) otResizerBox.style.display = 'none';
            }
        } else {
            selectedElement = null;
            otInspector.style.display = 'none';
            if (otResizerBox) otResizerBox.style.display = 'none';
        }
        setTimeout(() => { activateEditMode(); startGlobalObserver(); }, 100);
    }



    function setupGlobalKeyHandlers(doc) {
        if (!doc) return;
        if (doc.__otKeyHandlersBound) return; // 🚀 CRITICAL FIX: Prevent exponential listener leak!
        doc.__otKeyHandlersBound = true;
        
        doc.addEventListener('keydown', (e) => {
            if (!window.isEditing) return;
            const key = e.key.toLowerCase();
            if (e.ctrlKey && key === 'z') { e.preventDefault(); if (e.shiftKey) window.historyManager.redo(); else window.historyManager.undo(); }
            if (e.ctrlKey && key === 'y') { e.preventDefault(); window.historyManager.redo(); }
        });
    }

    setupGlobalKeyHandlers(document);

    function loadTab(tabName) {
        activeTab = tabName;
        otSidebar.querySelectorAll('.panel-tab').forEach(b => { 
            const isActive = b.getAttribute('data-tab') === tabName;
            b.style.color = isActive ? '#FF4500' : '#fff'; 
            b.style.opacity = isActive ? '1' : '0.5'; 
            b.classList.toggle('active', isActive);
        });
        
        const panel = document.getElementById('panel-content');
        if (!panel) return;
        
        panel.innerHTML = '';
        if (tabName === 'themes') {
            panel.innerHTML = '<div class="section-label">Şablon Temaları</div>';

            // Inject hover-reveal styles once per document lifecycle
            if (!document.getElementById('ot-theme-card-styles')) {
                const s = document.createElement('style');
                s.id = 'ot-theme-card-styles';
                s.textContent = `
                    .ot-theme-card {
                        position: relative;
                        width: 100%;
                        height: 48px;
                        border-radius: 12px;
                        cursor: pointer;
                        border: 1px solid rgba(255,255,255,0.08);
                        background: rgba(255,255,255,0.04);
                        transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
                        overflow: hidden;
                        outline: none;
                        flex-shrink: 0;
                    }
                    .ot-theme-card:hover {
                        border-color: rgba(255,255,255,0.25);
                        background: rgba(255,255,255,0.08);
                        transform: scaleX(1.01);
                    }
                    .ot-theme-card.ot-active {
                        border-color: #FF4500;
                        background: rgba(255,69,0,0.15);
                    }
                    .ot-theme-card .ot-theme-name {
                        position: absolute;
                        inset: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 0.82rem;
                        font-weight: 600;
                        letter-spacing: 0.04em;
                        color: #fff;
                        opacity: 0;
                        filter: blur(8px);
                        transition: opacity 0.22s ease, filter 0.22s ease;
                        pointer-events: none;
                        text-transform: capitalize;
                    }
                    .ot-theme-card:hover .ot-theme-name {
                        opacity: 1;
                        filter: blur(0);
                    }
                    .ot-theme-card.ot-active .ot-theme-name {
                        opacity: 1;
                        filter: blur(0);
                        color: #FF4500;
                    }
                `;
                document.head.appendChild(s);
            }

            try {
                const parentConfig = window.otTemplateConfig
                    || (window.parent && window.parent.currentTemplateConfig)
                    || null;
                const themes = parentConfig && parentConfig.supportedThemes;

                if (themes && themes.length > 0) {
                    const savedTheme = localStorage.getItem('open-temp-selected-theme')
                        || parentConfig.defaultTheme
                        || themes[0];

                    const grid = document.createElement('div');
                    grid.style.cssText = 'display:flex; flex-direction:column; gap:6px; margin-top:12px;';

                    themes.forEach(themePath => {
                        const raw = (themePath.split('theme-')[1] || themePath).replace('.css', '');
                        const label = raw.charAt(0).toUpperCase() + raw.slice(1);
                        const isActive = themePath === savedTheme;

                        const card = document.createElement('button');
                        card.className = 'ot-theme-card' + (isActive ? ' ot-active' : '');
                        card.dataset.themePath = themePath;
                        card.setAttribute('title', label);
                        card.type = 'button';

                        const nameSpan = document.createElement('span');
                        nameSpan.className = 'ot-theme-name';
                        nameSpan.innerText = label;
                        card.appendChild(nameSpan);

                        card.addEventListener('click', function() {
                            if (window.historyManager && window.historyManager.isProcessing) return;
                            try {
                                localStorage.setItem('open-temp-selected-theme', themePath);

                                // Direct DOM update — no factory dependency.
                                // inline_editor.js runs inside the template document,
                                // so document IS the template. Patch #theme-css directly.
                                let themeLink = document.getElementById('theme-css');
                                if (!themeLink || themeLink.tagName !== 'LINK') {
                                    if (themeLink) themeLink.remove();
                                    themeLink = document.createElement('link');
                                    themeLink.rel = 'stylesheet';
                                    themeLink.id = 'theme-css';
                                    document.head.appendChild(themeLink);
                                }
                                themeLink.setAttribute('href', otThemePrefix + themePath);

                                // Best-effort factory sync (updates shell header selector if open)
                                try {
                                    const factoryUpdater = window.otUpdateTheme
                                        || (window.parent && window.parent.updateTheme);
                                    if (typeof factoryUpdater === 'function') factoryUpdater(themePath);
                                } catch(e) {}

                                // Update card active states
                                grid.querySelectorAll('.ot-theme-card').forEach(c => {
                                    c.classList.toggle('ot-active', c.dataset.themePath === themePath);
                                });
                            } finally {
                                resetGlobalInteractionState();
                            }
                        });

                        grid.appendChild(card);
                    });

                    panel.appendChild(grid);
                } else {
                    panel.innerHTML += '<p style="color:#555; font-size:0.8rem; margin-top:16px; line-height:1.5;">Bu şablon için tema tanımlanmamış.<br><code style="color:#888;">supportedThemes</code> dizisini template.json\'a ekleyin.</p>';
                }
            } catch (e) {
                panel.innerHTML += '<p style="color:#ef4444; font-size:0.8rem; margin-top:12px;">Tema listesi yüklenemedi.</p>';
                console.warn('OT themes tab:', e);
            }
        }
        else if (tabName === 'elements') { 
            panel.innerHTML = `
                <div class="section-label">Page Blocks (Architect Edition)</div>
                <div class="typography-grid">
                    <button class="typography-btn" onclick="insertElement('hero-split')">Hero Split</button>
                    <button class="typography-btn" onclick="insertElement('bento-grid')">Bento Grid</button>
                    <button class="typography-btn" onclick="insertElement('feature-trio')">Feature Trio</button>
                    <button class="typography-btn" onclick="insertElement('cta-banner')">CTA Banner</button>
                    <button class="typography-btn" onclick="insertElement('faq-accord')">FAQ Accord</button>
                    <button class="typography-btn" onclick="insertElement('footer-mod')">Modern Foot</button>
                </div>
                <div class="section-label" style="margin-top:20px;">Standard Units</div>
                <div class="typography-grid">
                    <button class="typography-btn" onclick="insertElement('title')">H1</button>
                    <button class="typography-btn" onclick="insertElement('text')">Text</button>
                    <button class="typography-btn" onclick="insertElement('image')">Img</button>
                    <button class="typography-btn" onclick="insertElement('button')">Btn</button>
                </div>
                <div class="section-label" style="margin-top:20px;">Developer Tab</div>
                <div class="typography-grid">
                    <button class="typography-btn" onclick="insertElement('raw-html')" style="background:rgba(0,255,204,0.1); color:#00ffcc; border-color:#00ffcc;">[IDE] Source</button>
                </div>
            `; 
        }
        else if (tabName === 'widgets') { 
            panel.innerHTML = `
                <div class="section-label">Interactive Modules</div>
                <div class="typography-grid">
                    <button class="typography-btn" onclick="insertElement('slider')">Photo Slider</button>
                    <button class="typography-btn" onclick="insertElement('datatable')">Data Table</button>
                    <button class="typography-btn" onclick="insertElement('video')">Video</button>
                    <button class="typography-btn" onclick="insertElement('todo')">Todo</button>
                </div>
            `; 
        }

        else if (tabName === 'edit') {
            if (!selectedElement) { 
                panel.innerHTML = '<div style="text-align:center; padding:40px; color:#666;"><h3>No Element Selected</h3><p>Click any element in the template to start editing its properties here.</p></div>'; 
                return; 
            }
            
            const cs = getCS(selectedElement);
            const fs = parseInt(cs.fontSize) || 16;
            const pad = parseInt(cs.padding) || 0;
            const br = parseInt(cs.borderRadius) || 0;
            const lh = parseFloat(cs.lineHeight) || 1.2;

            panel.innerHTML = `
                <div class="edit-group">
                    <span class="section-label">Content Editor</span>
                    <textarea id="edit-text-val" placeholder="Element content..." style="width:100% !important; background:rgba(0,0,0,0.3) !important; border:1px solid rgba(255,255,255,0.1) !important; border-radius:12px !important; color:#fff !important; padding:12px !important; font-family:inherit !important; font-size:0.9rem !important; resize:vertical !important; min-height:80px !important;"></textarea>
                </div>
                
                <div class="edit-group">
                    <span class="section-label">Typography (Architect Edition)</span>
                    <div class="slider-row">
                        <span class="slider-label">Font Size</span>
                        <span class="slider-val" id="fs-val">${fs}px</span>
                    </div>
                    <input type="range" class="ot-range" id="size-range" min="8" max="150" value="${fs}">
                    
                    <div class="slider-row">
                        <span class="slider-label">Line Height</span>
                        <span class="slider-val" id="lh-val">${lh}</span>
                    </div>
                    <input type="range" class="ot-range" id="lh-range" min="0.8" max="3" step="0.1" value="${lh}">
                </div>

                <div class="edit-group">
                    <span class="section-label">Layout & Geometry</span>
                    <div class="slider-row">
                        <span class="slider-label">Padding</span>
                        <span class="slider-val" id="pad-val">${pad}px</span>
                    </div>
                    <input type="range" class="ot-range" id="pad-range" min="0" max="200" value="${pad}">
                    
                    <div class="slider-row">
                        <span class="slider-label">Corner Radius</span>
                        <span class="slider-val" id="br-val">${br}px</span>
                    </div>
                    <input type="range" class="ot-range" id="br-range" min="0" max="100" value="${br}">
                </div>

                <div class="edit-group">
                    <span class="section-label">Architect Palette</span>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <span class="slider-label" style="display:block; margin-bottom:8px;">Text Color</span>
                            <input type="color" class="ot-color-input" id="color-pick" value="${rgbToHex(cs.color)}">
                        </div>
                        <div>
                            <span class="slider-label" style="display:block; margin-bottom:8px;">Backdrop Color</span>
                            <input type="color" class="ot-color-input" id="bg-color-pick" value="${rgbToHex(cs.backgroundColor)}">
                        </div>
                    </div>
                </div>
            `;
            
            const textInput = panel.querySelector('#edit-text-val');
            textInput.value = selectedElement.innerHTML; // Safe: programmatic assignment avoids innerHTML injection
            let oldTextVal = "";
            textInput.addEventListener('focus', () => { oldTextVal = selectedElement.innerHTML; });
            textInput.addEventListener('input', (e) => { 
                selectedElement.innerHTML = e.target.value; 
                showInspector(selectedElement); 
            });
            textInput.addEventListener('change', (e) => {
                if (oldTextVal !== e.target.value) {
                    window.historyManager.execute(new TextEditCommand(selectedElement, oldTextVal, e.target.value));
                }
            });
            
            const syncSlider = (id, prop, valId, suffix = '') => {
                const el = panel.querySelector(id);
                if (el) {
                    let oldVal = "";
                    const capture = () => { oldVal = selectedElement.style[prop] || getCS(selectedElement)[prop]; };
                    el.addEventListener('mousedown', capture);
                    el.addEventListener('touchstart', capture);
                    el.addEventListener('input', (e) => {
                        selectedElement.style[prop] = e.target.value + suffix;
                        const label = panel.querySelector(valId);
                        if (label) label.innerText = e.target.value + suffix;
                        showInspector(selectedElement);
                    });
                    el.addEventListener('change', (e) => {
                        const newVal = e.target.value + suffix;
                        if (oldVal !== newVal) {
                            window.historyManager.execute(new StyleCommand(selectedElement, prop, oldVal, newVal));
                        }
                    });
                }
            };

            syncSlider('#size-range', 'fontSize', '#fs-val', 'px');
            syncSlider('#lh-range', 'lineHeight', '#lh-val', '');
            syncSlider('#pad-range', 'padding', '#pad-val', 'px');
            syncSlider('#br-range', 'borderRadius', '#br-val', 'px');

            const cp = panel.querySelector('#color-pick');
            let oldColor = "";
            cp.addEventListener('focus', () => { oldColor = selectedElement.style.color || getCS(selectedElement).color; });
            cp.addEventListener('input', (e) => { 
                selectedElement.style.color = e.target.value; 
                showInspector(selectedElement); 
            });
            cp.addEventListener('change', (e) => {
                if (oldColor !== e.target.value) {
                    window.historyManager.execute(new StyleCommand(selectedElement, 'color', oldColor, e.target.value));
                }
            });

            const bcp = panel.querySelector('#bg-color-pick');
            let oldBg = "";
            bcp.addEventListener('focus', () => { oldBg = selectedElement.style.backgroundColor || getCS(selectedElement).backgroundColor; });
            bcp.addEventListener('input', (e) => { 
                selectedElement.style.backgroundColor = e.target.value; 
                showInspector(selectedElement); 
            });
            bcp.addEventListener('change', (e) => {
                if (oldBg !== e.target.value) {
                    window.historyManager.execute(new StyleCommand(selectedElement, 'backgroundColor', oldBg, e.target.value));
                }
            });
        }

    }

    window.loadTab = loadTab; // Expose for inline onclick handlers (e.g. raw-html preset)
    otSidebar.querySelectorAll('.panel-tab').forEach(b => b.addEventListener('click', () => loadTab(b.getAttribute('data-tab'))));

    window.setEditMode = function(state) {
        window.isEditing = state;
        document.body.classList.toggle('editing', state);
        if (state) {
            activateEditMode();
            loadTab(activeTab); // Preserve user's current tab selection on re-entry
        } else {
            deactivateEditMode();
            if (typeof closeCodePanel === 'function') closeCodePanel();
        }

        // Sync Sidebar (Inline Editor's Sidebar)
        otSidebar.style.visibility = state ? 'visible' : 'hidden';
        otSidebar.style.opacity = state ? '1' : '0';
        otSidebar.style.transform = state ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(100%)';

        
        // 🏆 Visual Feedback for Toolbar
        const pb = otToolbar.querySelector('#btn-mode-preview');
        const eb = otToolbar.querySelector('#btn-mode-edit');
        if (pb && eb) {
            eb.style.background = state ? '#FF4500' : 'transparent';
            eb.style.color = state ? '#fff' : '#888';
            pb.style.background = state ? 'transparent' : '#FF4500';
            pb.style.color = state ? '#888' : '#fff';
        }
    };

    // --- 🏆 SIDEBAR TOGGLE LOGIC ---
    otSidebar.querySelector('#sidebar-toggle-btn').addEventListener('click', () => {
        isSidebarCollapsed = !isSidebarCollapsed;
        const state = window.isEditing;
        if (isSidebarCollapsed) {
            otSidebar.style.transform = 'translateX(-50%) translateY(calc(100% - 24px))';
        } else {
            otSidebar.style.transform = state ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(100%)';
        }
    });

    otToolbar.querySelector('#btn-mode-edit').addEventListener('click', (e) => {
        console.log("OpenTemp: Edit Clicked");
        e.preventDefault(); e.stopPropagation();
        window.setEditMode(true);
    });
    
    otToolbar.querySelector('#btn-mode-preview').addEventListener('click', (e) => {
        console.log("OpenTemp: Preview Clicked");
        e.preventDefault(); e.stopPropagation();
        window.setEditMode(false);
    });

    const exportBtn = otToolbar.querySelector('#inline-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            window.exportTemplate();
        });
    }

    // --- 🏆 CODE IDE PANEL ---
    var otCodePanel = document.createElement('div');
    otCodePanel.id = 'ot-code-panel';
    otCodePanel.dataset.open = '0';
    otCodePanel.style.cssText = 'position:fixed !important; bottom:90px !important; right:24px !important; width:680px !important; max-width:calc(100vw - 48px) !important; height:400px !important; background:rgba(10,10,12,0.98) !important; backdrop-filter:blur(20px) !important; border:1px solid rgba(0,255,204,0.25) !important; border-radius:20px !important; box-shadow:0 -10px 50px rgba(0,255,204,0.07), 0 25px 60px rgba(0,0,0,0.9) !important; z-index:2147483646 !important; display:none !important; flex-direction:column !important; overflow:hidden !important; color:#fff !important;';
    document.body.appendChild(otCodePanel);

    var codeTab = 'html';

    function openCodePanel() {
        otCodePanel.dataset.open = '1';
        otCodePanel.style.setProperty('display', 'flex', 'important');
        const cb = otToolbar.querySelector('#btn-mode-code');
        if (cb) { cb.style.background = 'rgba(0,255,204,0.2)'; cb.style.borderColor = 'rgba(0,255,204,0.4)'; }
        renderCodePanel();
    }

    function closeCodePanel() {
        otCodePanel.dataset.open = '0';
        otCodePanel.style.setProperty('display', 'none', 'important');
        const cb = otToolbar.querySelector('#btn-mode-code');
        if (cb) { cb.style.background = 'rgba(0,255,204,0.1)'; cb.style.borderColor = 'rgba(0,255,204,0.2)'; }
    }

    function getMatchedCSSRules(el) {
        const doc = el.ownerDocument;
        const matched = [];
        try {
            Array.from(doc.styleSheets).forEach(sheet => {
                let rules;
                try { rules = sheet.cssRules || sheet.rules; } catch(e) { return; }
                if (!rules) return;
                Array.from(rules).forEach(rule => {
                    try {
                        if (rule.selectorText && el.matches(rule.selectorText)) {
                            const txt = rule.style && rule.style.cssText;
                            if (txt) matched.push({ selector: rule.selectorText, css: txt });
                        }
                    } catch(e) {}
                });
            });
        } catch(e) {}
        return matched.slice(0, 10);
    }

    function renderCodePanel() {
        if (!selectedElement) {
            otCodePanel.innerHTML = '<div style="display:flex; align-items:center; padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(0,0,0,0.35); flex-shrink:0;">'
                + '<span style="font-size:0.75rem; color:#555; font-family:sans-serif;">Code IDE</span>'
                + '<button id="ot-code-close" style="margin-left:auto; background:transparent; color:#444; border:none; font-size:1rem; cursor:pointer; padding:2px 8px; font-family:sans-serif;">✕</button>'
                + '</div>'
                + '<div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:30px;">'
                + '<div style="font-size:2rem;">🖱️</div>'
                + '<div style="font-family:sans-serif; font-size:0.85rem; color:#555; text-align:center; line-height:1.6;">'
                + 'Enter <strong style="color:#FF4500;">Edit</strong> mode and click an element<br>to inspect and edit its code.'
                + '</div>'
                + '<button id="ot-enter-edit" style="background:#FF4500; color:#fff; border:none; padding:8px 20px; border-radius:10px; font-size:0.8rem; font-weight:700; cursor:pointer; font-family:sans-serif;">Enter Edit Mode</button>'
                + '</div>';
            otCodePanel.querySelector('#ot-code-close').addEventListener('click', closeCodePanel);
            const enterEditBtn = otCodePanel.querySelector('#ot-enter-edit');
            if (enterEditBtn) enterEditBtn.addEventListener('click', () => { window.setEditMode(true); });
            return;
        }
        const el = selectedElement;
        const tag = el.tagName.toLowerCase();
        const elId = el.id ? '#' + el.id : '';
        const cls = el.className && typeof el.className === 'string'
            ? el.className.split(' ').filter(c => c && !c.startsWith('ot-')).map(c => '.' + c).join('').substring(0, 30)
            : '';

        let codeContent = '';
        let placeholder = '';

        if (codeTab === 'html') {
            const clone = el.cloneNode(true);
            clone.removeAttribute('contenteditable');
            clone.removeAttribute('spellcheck');
            ['ot-editable-candidate','ot-selected','ot-dragging'].forEach(c => clone.classList.remove(c));
            if (clone.getAttribute('class') === '') clone.removeAttribute('class');
            codeContent = clone.outerHTML;
            placeholder = 'Edit element HTML...';
        } else if (codeTab === 'css') {
            codeContent = el.getAttribute('style') || '';
            placeholder = 'e.g.  color: red;  font-size: 18px;  padding: 20px;';
        } else if (codeTab === 'js') {
            const evtNames = ['onclick','onmouseover','onmouseout','onfocus','onblur','onchange','oninput','onkeydown','onkeyup','onload'];
            codeContent = evtNames.filter(ev => el.getAttribute(ev)).map(ev => ev + ': ' + el.getAttribute(ev)).join('\n');
            placeholder = 'e.g.  onclick: this.style.opacity=\'0.5\'';
        }

        let matchedHTML = '';
        if (codeTab === 'css') {
            const rules = getMatchedCSSRules(el);
            if (rules.length > 0) {
                matchedHTML = '<div style="padding:8px 16px 10px; border-top:1px solid rgba(255,255,255,0.05); overflow-y:auto; max-height:100px; flex-shrink:0; background:rgba(0,0,0,0.2);">'
                    + '<div style="font-size:0.6rem; color:#555; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; font-family:sans-serif;">Matched Stylesheet Rules (read-only)</div>'
                    + rules.map(r => '<div style="font-size:0.71rem; line-height:1.5; margin-bottom:2px; font-family:monospace;"><span style="color:rgba(0,255,204,0.6);">' + r.selector + '</span> <span style="color:#444;">{</span> <span style="color:#999;">' + r.css + '</span> <span style="color:#444;">}</span></div>').join('')
                    + '</div>';
            }
        }

        const tabs = ['html','css','js'];
        otCodePanel.innerHTML = '<div style="display:flex; align-items:center; padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(0,0,0,0.35); flex-shrink:0; gap:8px;">'
            + '<span style="font-size:0.68rem; color:#555; font-family:sans-serif; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">&lt;' + tag + elId + cls + '&gt;</span>'
            + '<div style="display:flex; gap:3px;">'
            + tabs.map(t => '<button data-code-tab="' + t + '" style="background:' + (codeTab===t ? 'rgba(0,255,204,0.12)' : 'transparent') + '; color:' + (codeTab===t ? '#00ffcc' : '#555') + '; border:1px solid ' + (codeTab===t ? 'rgba(0,255,204,0.25)' : 'transparent') + '; padding:4px 12px; border-radius:7px; font-size:0.72rem; font-weight:700; cursor:pointer; font-family:sans-serif; transition:0.15s;">' + t.toUpperCase() + '</button>').join('')
            + '</div>'
            + '<button id="ot-code-close" style="background:transparent; color:#444; border:none; font-size:1rem; cursor:pointer; padding:2px 8px; border-radius:6px; font-family:sans-serif; line-height:1.4;" title="Close (Esc)">✕</button>'
            + '</div>'
            + '<textarea id="ot-code-textarea" spellcheck="false" placeholder="' + placeholder + '" style="flex:1; background:transparent; border:none; color:#d4d4d4; font-family:\'Fira Code\',\'Cascadia Code\',\'Consolas\',\'Monaco\',monospace; font-size:0.79rem; line-height:1.65; padding:14px 16px; outline:none; resize:none; tab-size:2; min-height:0;"></textarea>'
            + matchedHTML
            + '<div style="display:flex; align-items:center; justify-content:space-between; padding:8px 14px; border-top:1px solid rgba(255,255,255,0.05); background:rgba(0,0,0,0.25); flex-shrink:0;">'
            + '<span style="font-size:0.65rem; color:#444; font-family:sans-serif;">Tab to indent · Ctrl+Enter to apply · Esc to close</span>'
            + '<button id="ot-code-apply" style="background:rgba(0,255,204,0.12); color:#00ffcc; border:1px solid rgba(0,255,204,0.25); padding:6px 18px; border-radius:9px; font-size:0.75rem; font-weight:700; cursor:pointer; font-family:sans-serif;">Apply</button>'
            + '</div>';

        const ta = otCodePanel.querySelector('#ot-code-textarea');
        ta.value = codeContent;

        otCodePanel.querySelectorAll('[data-code-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                codeTab = btn.getAttribute('data-code-tab');
                renderCodePanel();
            });
        });

        otCodePanel.querySelector('#ot-code-close').addEventListener('click', closeCodePanel);

        otCodePanel.querySelector('#ot-code-apply').addEventListener('click', () => {
            applyCodeEdit(otCodePanel.querySelector('#ot-code-textarea').value);
        });

        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const s = ta.selectionStart, end = ta.selectionEnd;
                ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
                ta.selectionStart = ta.selectionEnd = s + 2;
            } else if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                applyCodeEdit(ta.value);
            } else if (e.key === 'Escape') {
                e.stopPropagation(); // Don't bubble to global deselect handler
                closeCodePanel();
            }
        });

        ta.focus();
    }

    function applyCodeEdit(code) {
        if (!selectedElement) return;
        const el = selectedElement;
        const oldHTML = getCleanSnapshotHTML();
        try {
            if (codeTab === 'html') {
                const ownerDoc = el.ownerDocument;
                const wrapper = ownerDoc.createElement('div');
                wrapper.innerHTML = code;
                const newEl = wrapper.firstElementChild;
                if (!newEl) { showStatusToast('⚠️ Invalid HTML — no root element'); return; }
                newEl.contentEditable = 'true';
                newEl.classList.add('ot-editable-candidate');
                el.replaceWith(newEl);
                selectedElement = newEl;
                if (!newEl.id) newEl.id = 'ot-gen-' + Math.random().toString(36).substr(2, 9);
                lastSelectedId = newEl.id;
                showInspector(newEl);
            } else if (codeTab === 'css') {
                el.setAttribute('style', code);
                showInspector(el);
            } else if (codeTab === 'js') {
                const evtNames = ['onclick','onmouseover','onmouseout','onfocus','onblur','onchange','oninput','onkeydown','onkeyup','onload'];
                evtNames.forEach(ev => el.removeAttribute(ev));
                code.split('\n').forEach(line => {
                    const m = line.match(/^(on\w+)\s*:\s*(.+)$/);
                    if (m) el.setAttribute(m[1].trim(), m[2].trim());
                });
                showInspector(el);
            }
            const newHTML = getCleanSnapshotHTML();
            window.historyManager.record(new SnapshotCommand(oldHTML, newHTML));
            showStatusToast('✓ Code Applied');
            setTimeout(() => renderCodePanel(), 60);
        } catch(e) {
            showStatusToast('⚠️ ' + e.message.substring(0, 50));
            console.error('Code Apply Error:', e);
        }
    }

    const codeBtn = otToolbar.querySelector('#btn-mode-code');
    if (codeBtn) {
        codeBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (otCodePanel.dataset.open === '1') { closeCodePanel(); } else { openCodePanel(); }
        });
    }




    window.applyTheme = function(theme) {
        const doc = getIframeDoc();
        if (!doc) return;
        let color = '#FF4500';
        if (theme === 'cyber') color = '#00ffcc';
        else if (theme === 'minimal') color = '#ffffff';
        else if (theme === 'monochrome') color = '#888';
        doc.documentElement.style.setProperty('--accent', color);
        doc.documentElement.style.setProperty('--primary-color', color);
        // Backup to local storage or session if needed
    };

    function insertElement(type) {
        const doc = getIframeDoc();
        if (!doc) return;

        const oldH = getCleanSnapshotHTML();

        let el = doc.createElement('div');
        el.className = 'ot-inserted-block';
        el.style.cssText = 'position:relative; margin:20px auto; border-radius:32px; overflow:hidden; display:block !important; width:100% !important; max-width:1100px !important; box-sizing:border-box !important;';

        // --- 🏆 CLASSIC RESTORATION: Force Vertical Body ---
        doc.body.style.display = 'flex';
        doc.body.style.flexDirection = 'column';
        doc.body.style.flexWrap = 'nowrap';
        doc.body.style.alignItems = 'center'; // Center elements globally
        doc.body.style.paddingBottom = '250px'; // 🏆 LARGE SPACER FOR UI OVERLAP

        const presets = {
            'title': `<h1 style="font-size:3rem; font-weight:900; letter-spacing:-1px; margin-bottom:20px; padding:0 20px;">Main Heading Title</h1>`,
            'text': `<p style="font-size:1.1rem; opacity:0.7; line-height:1.7; padding:0 20px;">This is a premium typography block. Use it to describe your incredible features or tell your story with professional clarity.</p>`,
            'image': `<div style="padding:0 20px;"><img src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200" style="width:100%; border-radius:32px; display:block;"></div>`,
            'button': `<div style="padding:20px;"><button style="background:#FF4500; color:#fff; border:none; padding:18px 42px; border-radius:18px; font-weight:800; font-size:1rem; cursor:pointer; box-shadow:0 10px 30px rgba(255,69,0,0.3);">Get Started</button></div>`,
            'hero-split': `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:30px; padding:60px 40px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.1); border-radius:48px; align-items:center; margin:0 20px; box-sizing:border-box;">
                    <div>
                        <h1 style="font-size:3rem; font-weight:900; margin-bottom:20px; line-height:1.1;">Visionary Builder</h1>
                        <p style="font-size:1.1rem; opacity:0.6; margin-bottom:30px;">Experience the next generation of web design with our Architect Edition templates.</p>
                        <button style="background:#FF4500; color:#fff; border:none; padding:15px 35px; border-radius:15px; font-weight:800; cursor:pointer;">Exploration</button>
                    </div>
                    <div style="background:rgba(255,255,255,0.05); border-radius:24px; height:350px; overflow:hidden;">
                        <img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800" style="width:100%; height:100%; object-fit:cover; opacity:0.8;">
                    </div>
                </div>`,
            'bento-grid': `
                <div style="display:grid; grid-template-columns:repeat(3, 1fr); grid-template-rows:250px 250px; gap:20px;">
                    <div style="grid-column:span 2; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:32px; padding:40px;"><h3>Main Focus</h3></div>
                    <div style="background:rgba(255,69,0,0.1); border:1px solid #FF4500; border-radius:32px; padding:40px;"><h3>Accent</h3></div>
                    <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:32px; padding:40px;"><h3>Detail A</h3></div>
                    <div style="grid-column:span 2; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:32px; padding:40px;"><h3>Detail B</h3></div>
                </div>`,
            'feature-trio': `
                <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:30px;">
                    ${[1,2,3].map(i => `
                        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); padding:40px; border-radius:32px; transition:0.3s;" onmouseover="this.style.transform='translateY(-10px)'" onmouseout="this.style.transform='none'">
                            <div style="font-size:2rem; margin-bottom:20px;">0${i}</div>
                            <h3 style="margin-bottom:15px;">Feature Area</h3>
                            <p style="opacity:0.6; font-size:0.9rem;">Modern flex layout block with subtle hover lift and premium spacing.</p>
                        </div>
                    `).join('')}
                </div>`,
            'cta-banner': `<div style="background:#FF4500; padding:80px; text-align:center; border-radius:40px;"><h2 style="font-size:3rem; color:#fff; margin-bottom:30px;">Ready to create something bold?</h2><button style="background:#fff; color:#FF4500; border:none; padding:18px 50px; border-radius:18px; font-weight:900; cursor:pointer;">Join the Movement</button></div>`,
            'faq-accord': `<div style="max-width:800px; margin:0 auto;"><details style="background:rgba(255,255,255,0.03); padding:20px; border-radius:15px; margin-bottom:10px;"><summary style="font-weight:bold; cursor:pointer;">How does the Architect Engine work?</summary><p style="margin-top:15px; opacity:0.6;">It uses semantic HTML and advanced CSS Grid for production-grade web builds.</p></details></div>`,
            'footer-mod': `<div style="display:grid; grid-template-columns:2fr 1fr 1fr; padding:80px 40px; border-top:1px solid rgba(255,255,255,0.1); margin-top:100px;"><div><h3>OpenTemp</h3><p style="opacity:0.4;">The future of one-touch web design.</p></div><div><h4>Explore</h4><p>Templates</p></div><div><h4>Legal</h4><p>Terms</p></div></div>`,
            'raw-html': `<div style="border:2px dashed #00ffcc; padding:60px; text-align:center; color:#00ffcc; background:rgba(0,255,204,0.05); cursor:pointer;" onclick="loadTab('elements')">[ INITIALIZING SOURCE IDE... ]</div>`
        };

        if (presets[type]) {
            el.innerHTML = presets[type];
        } else if (WidgetEngine.registry[type]) {
            el = WidgetEngine.inject(type, doc);
        } else {
            return;
        }

        if (el) {
            doc.body.appendChild(el);
            activateEditMode();
            selectedElement = el;
            showInspector(el, true);

            const newH = getCleanSnapshotHTML();
            window.historyManager.record(new SnapshotCommand(oldH, newH));

            // --- 🎥 AUTO-FOCUS CAMERA ---
            setTimeout(() => {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }
    window.insertElement = insertElement;



    function showInspector(el, forceSidebarSync = false) {
        if (!window.isEditing) return;
        if (!el) {
            selectedElement = null; // 🚀 Proper null safety
            otInspector.style.display = 'none';
            if (otResizerBox) otResizerBox.style.display = 'none';
            return;
        }
        selectedElement = el;
        
        // 🚀 Selection Persistence: Store unique ID for history recovery
        if (!el.id) el.id = 'ot-gen-' + Math.random().toString(36).substr(2, 9);
        lastSelectedId = el.id;

        otInspector.style.display = 'flex';
        if (otResizerBox) otResizerBox.style.display = 'block';
        const rect = el.getBoundingClientRect();
        const iframe = document.getElementById('template-iframe');
        const iframeRect = iframe ? iframe.getBoundingClientRect() : { top:0, left:0 };
        const top = window.pageYOffset + iframeRect.top + rect.top;
        const left = window.pageXOffset + iframeRect.left + rect.left;
        otInspector.style.top = `${top - 60}px`;
        otInspector.style.left = `${left + rect.width/2 - 100}px`;
        otResizerBox.style.top = `${top}px`;
        otResizerBox.style.left = `${left}px`;
        otResizerBox.style.width = `${rect.width}px`;
        otResizerBox.style.height = `${rect.height}px`;
        // ISOLATION GUARD: Never switch tabs during an active undo/redo operation.
        // forceSidebarSync=true is only meaningful for deliberate user clicks.
        if (forceSidebarSync && !window.historyManager.isProcessing) loadTab('edit');

        // Auto-refresh Code Panel when a new element is selected
        if (otCodePanel && otCodePanel.dataset.open === '1') renderCodePanel();
    }

    // --- 🏆 FOCUS / DESELECT SYSTEM ---
    // Deselects the active element: hides inspector, resize box, clears edit/code panels.
    // Guards: never fires during drag or resize — interaction flags are checked by callers.
    function deselectElement() {
        if (!selectedElement) return;
        selectedElement = null;
        lastSelectedId = null;
        otInspector.style.display = 'none';
        if (otResizerBox) {
            otResizerBox.style.display = 'none';
            otResizerBox.style.boxShadow = '0 0 15px rgba(255,69,0,0.2)'; // reset glow
        }
        if (otCodePanel && otCodePanel.dataset.open === '1') renderCodePanel();
        if (activeTab === 'edit') {
            const panel = document.getElementById('panel-content');
            if (panel) panel.innerHTML = '<div style="text-align:center; padding:50px 24px; color:#444; font-family:sans-serif;"><div style="font-size:2rem; margin-bottom:12px; opacity:0.4;">⬡</div><div style="font-size:0.82rem; line-height:1.7;">Click any element<br>to edit its properties</div></div>';
        }
    }

    function activateEditMode() {
        const doc = getIframeDoc();
        if (!doc) return;
        if (editAbortController) editAbortController.abort();
        editAbortController = new AbortController();
        const iframeDoc = doc;

        // --- 🏆 CLASSIC RESTORATION: Force Vertical Body Global ---
        if (iframeDoc && iframeDoc.body) {
            iframeDoc.body.style.display = 'flex';
            iframeDoc.body.style.flexDirection = 'column';
            iframeDoc.body.style.flexWrap = 'nowrap';
            iframeDoc.body.style.alignItems = 'center';
            iframeDoc.body.style.paddingBottom = '250px';
        }

        // DEDUP: In standalone/embedded mode document === iframeDoc.
        const activationDocs = [...new Set([document, iframeDoc].filter(Boolean))];
        activationDocs.forEach(d => {
            d.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, li').forEach(node => {
                if (window.isInternalUI(node)) return;
                node.contentEditable = 'true';
                node.classList.add('ot-editable-candidate');
            });
            d.addEventListener('mousedown', (e) => {
                if (window.isInternalUI(e.target)) return;
                const target = e.target.closest('h1, h2, h3, h4, h5, h6, p, span, div, li, .ot-widget');
                if (target) { selectedElement = target; showInspector(target, true); }
                // Click lands on empty space (not a selectable element) → deselect
                else if (selectedElement && !isDraggingNode && !isBoxResizing) deselectElement();
            }, { signal: editAbortController.signal });

            // --- 🏆 PROXIMITY BOUNDARY: visual deselect-zone indicator ---
            // When mouse drifts outside the resize box, the border shifts from orange→dim
            // to signal "clicking here will deselect". Guards: skip during any interaction.
            d.addEventListener('mousemove', (e) => {
                if (!selectedElement || !window.isEditing) return;
                if (isDraggingNode || isBoxResizing) return;
                if (!otResizerBox || otResizerBox.style.display === 'none') return;

                const BOUNDARY = 32; // px — proximity zone around selection box
                const br = otResizerBox.getBoundingClientRect();
                const iframe = document.getElementById('template-iframe');
                const iframeRect = iframe ? iframe.getBoundingClientRect() : { top:0, left:0 };
                // Translate mouse coords to page-relative for comparison with the box
                const mx = e.clientX + (d !== document ? iframeRect.left : 0);
                const my = e.clientY + (d !== document ? iframeRect.top : 0);

                const outside = mx < br.left - BOUNDARY || mx > br.right + BOUNDARY
                             || my < br.top  - BOUNDARY || my > br.bottom + BOUNDARY;
                const nearEdge = !outside && (
                    mx < br.left + BOUNDARY || mx > br.right - BOUNDARY ||
                    my < br.top  + BOUNDARY || my > br.bottom - BOUNDARY
                );

                if (outside) {
                    // Far outside — neutral dim state
                    otResizerBox.style.borderColor = 'rgba(255,69,0,0.35)';
                    otResizerBox.style.boxShadow  = '0 0 8px rgba(255,69,0,0.08)';
                } else if (nearEdge) {
                    // Near the boundary edge — warn: "about to leave selection"
                    otResizerBox.style.borderColor = 'rgba(255,69,0,0.6)';
                    otResizerBox.style.boxShadow  = '0 0 18px rgba(255,69,0,0.25)';
                } else {
                    // Comfortably inside
                    otResizerBox.style.borderColor = '#FF4500';
                    otResizerBox.style.boxShadow  = '0 0 15px rgba(255,69,0,0.2)';
                }
            }, { signal: editAbortController.signal });
        });

        // --- 🏆 ESC KEY: instant deselect ---
        document.addEventListener('keydown', (e) => {
            if (!window.isEditing || e.key !== 'Escape') return;
            if (isDraggingNode || isBoxResizing) return;
            deselectElement();
        }, { signal: editAbortController.signal });

        setupGlobalKeyHandlers(iframeDoc);
        startGlobalObserver();
    }

    function deactivateEditMode() {
        stopGlobalObserver();
        if (editAbortController) editAbortController.abort();
        
        const doc = getIframeDoc();
        [document, doc].forEach(d => {
            if (!d) return;
            d.querySelectorAll('[contenteditable]').forEach(n => { 
                n.removeAttribute('contenteditable'); 
                n.classList.remove('ot-editable-candidate'); 
            });
        });

        // 🚀 CRITICAL: Hide all editor UI remnants
        if (otInspector) otInspector.style.display = 'none';
        if (otResizerBox) otResizerBox.style.display = 'none';
        resetGlobalInteractionState();
    }

    window.isInternalUI = function(node) {
        return !!node.closest('#inline-editor-toolbar, #inline-editor-sidebar, #inline-selection-box, #inline-element-inspector, #inline-drag-global-overlay, #ot-code-panel');
    };

    // Global interaction handlers for drag/move
    let dragStartTransform = '';
    let initialX = 0, initialY = 0;

    function getTransformXY(el) {
        const style = window.getComputedStyle(el);
        // Fallback or identity matrix if transform is none
        if (!style.transform || style.transform === 'none') return { x: 0, y: 0 };
        const matrix = new DOMMatrixReadOnly(style.transform);
        return { x: matrix.m41, y: matrix.m42 };
    }

    otDragBar.addEventListener('mousedown', (e) => {
        if (!selectedElement) return;
        e.preventDefault(); // 🚀 FIX: Prevent native text selection highlighter during dragging
        
        dragStartTransform = selectedElement.style.transform || 'translate(0px, 0px)';
        const currentPos = getTransformXY(selectedElement);
        initialX = currentPos.x;
        initialY = currentPos.y;

        isDraggingNode = true;
        startX = e.clientX; 
        startY = e.clientY;
        
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', handleDragEnd);
    });

    function handleDrag(e) {
        if (!isDraggingNode || !selectedElement) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        selectedElement.style.transform = `translate(${initialX + dx}px, ${initialY + dy}px)`;
        showInspector(selectedElement);
    }

    function handleDragEnd() {
        if (!isDraggingNode || !selectedElement) {
            resetGlobalInteractionState();
            return;
        }

        const currentPos = getTransformXY(selectedElement);
        const dragEndTransform = `translate(${currentPos.x}px, ${currentPos.y}px)`;
        
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', handleDragEnd);
        
        if (dragStartTransform !== dragEndTransform) {
            const moveCmd = new MoveCommand(selectedElement, dragStartTransform, dragEndTransform);
            window.historyManager.record(moveCmd);
        }
        
        resetGlobalInteractionState();
    }

    setInterval(() => {
        const doc = getIframeDoc();
        if (!doc) return;
        const now = new Date();
        doc.querySelectorAll('.ot-clock').forEach(clock => {
            const h = clock.querySelector('.hour'), m = clock.querySelector('.min'), s = clock.querySelector('.sec');
            if (h) h.style.transform = `rotate(${now.getHours() * 30 + now.getMinutes() / 2}deg)`;
            if (m) m.style.transform = `rotate(${now.getMinutes() * 6}deg)`;
            if (s) s.style.transform = `rotate(${now.getSeconds() * 6}deg)`;
        });
    }, 1000);
});

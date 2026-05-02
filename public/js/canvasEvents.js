// ============================================================
// Canvas events
// ============================================================

export function registerCanvasEvents(canvas, { applyTool, pushUndo, openTokenModal, render, renderInitList, sendWithSeq, activeTab }) 
{ 
    canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const { row, col } = canvasToCell(e.clientX - rect.left, e.clientY - rect.top);
    if (!isValid(row, col)) return;
    pushUndo();
    const cell = mapData.cells[row][col];
    if (activeTab === 'terrain')        cell.terrain = 'grass';
    else if (activeTab === 'elevation') cell.elevation = 0;
    else if (activeTab === 'features')  cell.feature = null;
    else if (activeTab === 'tokens')    cell.token = null;
    else { cell.terrain = 'grass'; cell.elevation = 0; cell.feature = null; cell.token = null; }

    // FIX: sync context-menu changes to server
    sendWithSeq({ type: 'update_cell', row, col, cell });
    render();
    });

    canvas.addEventListener('mousedown', e => {
    if (e.button === 2) return;
    if (e.button === 1) {
        e.preventDefault();
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };
        return;
    }
    if (isPanMode) {
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const { row, col } = canvasToCell(e.clientX - rect.left, e.clientY - rect.top);
    if (!isValid(row, col)) return;

    // Move mode — start drag
    if (isMoveMode) {
        if (mapData.cells[row][col].token) {
        draggingTokenFrom = { row, col };
        }
        return;
    }

    // Double-click opens token modal
    if (e.detail === 2 && mapData.cells[row][col].token) {
        openTokenModal(row, col);
        return;
    }

    pushUndo();
    isPainting = true;
    applyTool(row, col);
    render();
    });

    canvas.addEventListener('mousemove', e => {
    dragGhostEl.style.left = e.clientX + 'px';
    dragGhostEl.style.top = e.clientY + 'px';

    if (isPanning && panStart) {
        camera.x = panStart.cx + (e.clientX - panStart.x);
        camera.y = panStart.cy + (e.clientY - panStart.y);
        render();
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const { row, col } = canvasToCell(mx, my);

    if (isValid(row, col)) {
        document.getElementById('coordDisplay').textContent = `${colLabel(col)}${row + 1}`;
    } else {
        document.getElementById('coordDisplay').textContent = '\u2014';
    }

    if (isPainting && isValid(row, col)) {
        applyTool(row, col);
        render();
    }

    if (draggingTokenFrom && isValid(row, col)) {
        render();
        const s = cs();
        ctx.strokeStyle = '#f5a623';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(col * s + camera.x + 1, row * s + camera.y + 1, s - 2, s - 2);
    }
    });

    canvas.addEventListener('mouseup', e => {
    // End panning
    if (isPanning) {
        isPanning = false;
        panStart = null;
        return;
    }

    // Handle token drag movement
    if (draggingTokenFrom) {
        const rect = canvas.getBoundingClientRect();
        const { row, col } = canvasToCell(e.clientX - rect.left, e.clientY - rect.top);

        if (
        isValid(row, col) &&
        (row !== draggingTokenFrom.row || col !== draggingTokenFrom.col)
        ) {
        if (!mapData.cells[row][col].token) {
            pushUndo();

            // FIX: apply the move locally so the sender sees it immediately
            mapData.cells[row][col].token =
            mapData.cells[draggingTokenFrom.row][draggingTokenFrom.col].token;
            mapData.cells[draggingTokenFrom.row][draggingTokenFrom.col].token = null;

            sendWithSeq({
            type: 'move_token',
            from: draggingTokenFrom,
            to: { row, col },
            });

            render();
            setTimeout(renderInitList, 50);
        }
        }

        draggingTokenFrom = null;
        return;
    }

    // Stop painting
    isPainting = false;
    });

    canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const oldZ = zoom;
    zoom = Math.max(0.15, Math.min(4.0, zoom + (e.deltaY > 0 ? -0.08 : 0.08)));
    const sc = zoom / oldZ;
    camera.x = mx - sc * (mx - camera.x);
    camera.y = my - sc * (my - camera.y);
    document.getElementById('zoomSlider').value = zoom;
    render();
    }, { passive: false });

    canvas.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    });

    canvas.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragCanvasToken) return;
    const rect = canvas.getBoundingClientRect();
    const { row, col } = canvasToCell(e.clientX - rect.left, e.clientY - rect.top);
    if (!isValid(row, col) || mapData.cells[row][col].token) return;
    pushUndo();
    mapData.cells[row][col].token = {
        type: dragCanvasToken.type,
        name: dragCanvasToken.label,
        hp: 10,
        maxHp: 10,
        isPlayer: dragCanvasToken.isPlayer,
        initiative: 0,
    };

    // FIX: sync drag-from-sidebar token placement to server
    sendWithSeq({
        type: 'update_cell',
        row,
        col,
        cell: mapData.cells[row][col],
    });

    render();
    isDraggingFromSidebar = false;
    dragCanvasToken = null;
    dragGhostEl.style.display = 'none';
    });
}


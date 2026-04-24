// ============================================================
// Shared mutable state
// ============================================================

let mapData = { width: 20, height: 20, cells: [] };
let camera = { x: 0, y: 0 };
let zoom = 1.0;
let baseCellSize = 40;
let isPanMode = false;
let isMoveMode = false;
let isPlaceMode = true;
let isPainting = false;
let isPanning = false;
let panStart = null;
let activeTool = { category: 'terrain', value: 'grass' };
let activeTab = 'terrain';
let undoStack = [];
let redoStack = [];
let gridAlpha = 0.15;
let gridColorHex = '#ffffff';

let draggingTokenFrom = null;
let dragCanvasToken = null;
let isDraggingFromSidebar = false;

let editingTokenPos = null;

let currentTurn = 0;
let initTrackerOpen = false;

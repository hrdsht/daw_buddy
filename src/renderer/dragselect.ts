'use strict';

/**
 * Native OS Drag-and-Drop & Multi-Selection System.
 */

import { el, formatBytes, toast } from './dom';

export interface SelectedItem {
  id: string;
  name: string;
  path: string;
  size?: number;
  type?: string;
}

export const SelectionState = {
  active: false,
  items: new Map<string, SelectedItem>(),
  lastSelectedId: null as string | null,

  enable() {
    this.active = true;
    document.body.classList.add('multi-select-mode');
    updateSelectionBar();
    updateSelectionHighlights();
  },

  disable() {
    this.active = false;
    this.items.clear();
    this.lastSelectedId = null;
    document.body.classList.remove('multi-select-mode');
    removeSelectionBar();
    updateSelectionHighlights();
  },

  toggle(item: SelectedItem) {
    if (this.items.has(item.id)) {
      this.items.delete(item.id);
      if (this.items.size === 0) {
        this.disable();
        return;
      }
    } else {
      if (!this.active) {
        this.active = true;
        document.body.classList.add('multi-select-mode');
      }
      this.items.set(item.id, item);
      this.lastSelectedId = item.id;
    }
    updateSelectionBar();
    updateSelectionHighlights();
  },

  select(item: SelectedItem) {
    if (!this.active) {
      this.active = true;
      document.body.classList.add('multi-select-mode');
    }
    this.items.set(item.id, item);
    this.lastSelectedId = item.id;
    updateSelectionBar();
    updateSelectionHighlights();
  },

  selectAll(items: SelectedItem[]) {
    if (!this.active) {
      this.active = true;
      document.body.classList.add('multi-select-mode');
    }
    items.forEach((item) => this.items.set(item.id, item));
    updateSelectionBar();
    updateSelectionHighlights();
  },

  isSelected(id: string) {
    return this.items.has(id);
  },

  count() {
    return this.items.size;
  },

  getFilePaths(): string[] {
    return (Array.from(this.items.values()) as SelectedItem[])
      .map((i) => i.path)
      .filter(Boolean);
  },

  getTotalSize(): number {
    return (Array.from(this.items.values()) as SelectedItem[]).reduce(
      (sum: number, i) => sum + (i.size || 0),
      0
    );
  }
};

export function updateSelectionHighlights() {
  document.querySelectorAll('[data-selectable-id]').forEach((node: any) => {
    const id = node.getAttribute('data-selectable-id');
    const isSelected = SelectionState.isSelected(id);
    node.classList.toggle('is-multi-selected', isSelected);
    const cb = node.querySelector('.filerow__select-handle, .row__select-handle');
    if (cb) {
      cb.classList.toggle('is-checked', isSelected);
    }
  });
}

export function updateSelectionBar() {
  let bar = document.querySelector('.floating-selection-bar') as HTMLElement;
  if (!bar) {
    bar = el('div', 'floating-selection-bar');
    document.body.append(bar);
  }

  const count = SelectionState.count();
  if (count === 0) {
    bar.remove();
    return;
  }

  const totalSize = SelectionState.getTotalSize();
  const filePaths = SelectionState.getFilePaths();

  bar.innerHTML = '';

  const left = el('div', 'selection-bar__info');
  left.append(el('span', 'selection-bar__badge', `${count}`));
  left.append(
    el(
      'span',
      'selection-bar__label',
      `${count} file${count === 1 ? '' : 's'} selected${totalSize ? ` · ${formatBytes(totalSize)}` : ''}`
    )
  );
  bar.append(left);

  const actions = el('div', 'selection-bar__actions');

  // Drag button (draggable itself to initiate multi-drag!)
  const dragBtn = el('button', 'pill pill--solid selection-bar__drag-btn', `⤓ Drag ${count} to DAW`);
  dragBtn.title = 'Click or drag this button directly into your DAW or a folder!';
  dragBtn.draggable = true;
  dragBtn.addEventListener('dragstart', async (e: DragEvent) => {
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', filePaths.join('\n'));
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }
    if (window.api && window.api.dragFiles) {
      await window.api.dragFiles(filePaths);
    }
  });
  dragBtn.addEventListener('click', async () => {
    if (window.api && window.api.dragFiles) {
      await window.api.dragFiles(filePaths);
    }
  });
  actions.append(dragBtn);

  // Copy paths button
  const copyBtn = el('button', 'pill', '📋 Copy Paths');
  copyBtn.title = 'Copy all selected file paths to clipboard';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(filePaths.join('\n'));
    toast('Copied', `${count} path${count === 1 ? '' : 's'} copied to clipboard`);
  });
  actions.append(copyBtn);

  // Reveal first in Explorer
  if (filePaths.length > 0) {
    const fileManager = (window as any).settings?.fileManager || 'Explorer';
    const revealBtn = el('button', 'pill', `Show in ${fileManager}`);
    revealBtn.addEventListener('click', () => {
      if (window.api) window.api.reveal(filePaths[0]);
    });
    actions.append(revealBtn);
  }

  // Clear / Done button
  const clearBtn = el('button', 'pill pill--ghost', '✕ Clear');
  clearBtn.title = 'Clear selection (Esc)';
  clearBtn.addEventListener('click', () => SelectionState.disable());
  actions.append(clearBtn);

  bar.append(actions);
}

export function removeSelectionBar() {
  document.querySelectorAll('.floating-selection-bar').forEach((n) => n.remove());
}

// Global ESC key listener to clear selection
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && SelectionState.active) {
    SelectionState.disable();
  }
});

export function createSelectHandle(item: SelectedItem) {
  const handle = el(
    'div',
    `filerow__select-handle ${SelectionState.isSelected(item.id) ? 'is-checked' : ''}`
  );
  handle.title = 'Click to select · Long-press to multi-select';
  handle.innerHTML = `<span class="select-handle__check">✓</span>`;
  handle.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    SelectionState.toggle(item);
  });
  return handle;
}

export function attachDraggableAndSelectable(rowElement: HTMLElement, item: SelectedItem) {
  rowElement.draggable = true;
  rowElement.setAttribute('data-selectable-id', item.id);
  rowElement.classList.add('draggable-row');

  if (SelectionState.isSelected(item.id)) {
    rowElement.classList.add('is-multi-selected');
  }

  // Native File Dragging
  rowElement.addEventListener('dragstart', async (e: DragEvent) => {
    let pathsToDrag = [item.path];
    if (SelectionState.active && SelectionState.isSelected(item.id)) {
      pathsToDrag = SelectionState.getFilePaths();
    }

    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', pathsToDrag.join('\n'));
      e.dataTransfer.effectAllowed = 'copy';
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      e.dataTransfer.setDragImage(canvas, 0, 0);
    }

    if (window.api && window.api.dragFiles) {
      await window.api.dragFiles(pathsToDrag);
    }
  });

  // Long-press detection (450ms)
  let pressTimer: any = null;
  let startX = 0;
  let startY = 0;
  let isLongPress = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('.filerow__select-handle') ||
      target.closest('.row__select-handle')
    ) {
      return;
    }

    isLongPress = false;
    startX = e.clientX;
    startY = e.clientY;

    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      isLongPress = true;
      SelectionState.toggle(item);
      rowElement.classList.add('row--pulse-select');
      setTimeout(() => rowElement.classList.remove('row--pulse-select'), 300);
      try {
        if ('vibrate' in navigator) navigator.vibrate(40);
      } catch {}
    }, 450);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
      clearTimeout(pressTimer);
    }
  };

  const onPointerUp = () => {
    clearTimeout(pressTimer);
  };

  rowElement.addEventListener('pointerdown', onPointerDown);
  rowElement.addEventListener('pointermove', onPointerMove);
  rowElement.addEventListener('pointerup', onPointerUp);
  rowElement.addEventListener('pointercancel', onPointerUp);

  // When multi-select mode is active, clicking row toggles selection
  rowElement.addEventListener('click', (e: MouseEvent) => {
    if (isLongPress) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey || SelectionState.active) {
      const target = e.target as HTMLElement;
      if (!target.closest('button') && !target.closest('a')) {
        e.preventDefault();
        e.stopPropagation();
        SelectionState.toggle(item);
      }
    }
  });
}

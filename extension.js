
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const COLORS = [
    '#F4D35E',
    '#F28B82',
    '#AECBFA',
    '#CCFF90',
    '#D7AEFB',
];

const PANEL_BOX = 'left';

const StickyNote = GObject.registerClass(
class StickyNote extends PanelMenu.Button {
    _init(note, onChanged, onDelete) {
        super._init(0.5, 'Sticky Note', false);

        this._note = note;
        this._onChanged = onChanged;
        this._onDelete = onDelete;

        this._closeTimeout = 0;
        this._destroying = false;

        // Colored dot in the top bar.
        const dot = new St.Widget({
            style_class: 'sticky-note-dot',
            width: 14,
            height: 14,
        });

        dot.set_style(`background-color: ${note.color};`);
        this.add_child(dot);

        this.menu.actor.add_style_class_name('sticky-note-menu');
        this.menu.setSourceAlignment(0.5);

        this._buildMenu();

        // Open the note when the pointer enters its top-bar button.
        this.connect('enter-event', () => {
            this._cancelClose();

            if (!this.menu.isOpen)
                this.menu.open();

            return Clutter.EVENT_PROPAGATE;
        });

        // Do not immediately close when the pointer leaves the dot.
        // The timeout checks whether the pointer has entered the popup.
        this.connect('leave-event', () => {
            this._scheduleClose();

            return Clutter.EVENT_PROPAGATE;
        });
    }

    _buildMenu() {
        const card = new St.BoxLayout({
            vertical: true,
            style_class: 'sticky-note-card',
        });

        card.set_style(`background-color: ${this._note.color};`);

        this._card = card;

        // Toolbar.
        const toolbar = new St.BoxLayout({
            style_class: 'sticky-note-toolbar',
        });

        const bullet = this._makeToolButton('•');
        const checkbox = this._makeToolButton('☐');
        const check = this._makeToolButton('✓');

        bullet.connect('clicked', () => {
            this._insertMarker('• ');
        });

        checkbox.connect('clicked', () => {
            this._insertMarker('☐ ');
        });

        check.connect('clicked', () => {
            this._toggleCheckbox();
        });

        toolbar.add_child(bullet);
        toolbar.add_child(checkbox);
        toolbar.add_child(check);

        // Editable text.
        this._text = new Clutter.Text({
            text: this._note.text,
            editable: true,
            selectable: true,
            activatable: false,
            reactive: true,
            line_wrap: true,
            single_line_mode: false,
        });

        this._text.set_width(260);

        this._text.connect('text-changed', () => {
            this._note.text = this._text.get_text();
            this._onChanged();
        });

        // Handle Enter for bullet and checkbox continuation.
        this._text.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();

            if (key === Clutter.KEY_Return ||
                key === Clutter.KEY_KP_Enter) {
                this._handleEnter();
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });

        // Detect clicks on checkbox markers.
        this._text.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;

            const [stageX, stageY] = event.get_coords();

            const [success, x, y] =
                this._text.transform_stage_point(stageX, stageY);

            if (!success)
                return Clutter.EVENT_PROPAGATE;

            const position = this._text.coords_to_position(x, y);

            if (position < 0)
                return Clutter.EVENT_PROPAGATE;

            const chars = Array.from(this._text.get_text());
            const lineStart = this._lineStart(chars, position);

            const marker = chars
                .slice(lineStart, lineStart + 2)
                .join('');

            if ((marker === '☐ ' || marker === '☑ ') &&
                position <= lineStart + 1) {
                this._toggleCheckboxAt(lineStart);
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });

        // Scrollable text container.
        const textContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });

        textContainer.add_child(this._text);

        const scroll = new St.ScrollView({
            style_class: 'sticky-note-scroll',
            width: 280,
            height: 190,
            overlay_scrollbars: true,
        });

        scroll.set_policy(
            St.PolicyType.NEVER,
            St.PolicyType.AUTOMATIC
        );

        scroll.set_child(textContainer);

        card.add_child(toolbar);
        card.add_child(scroll);

        const section = new PopupMenu.PopupMenuSection();
        section.actor.add_child(card);

        this.menu.addMenuItem(section);

        // Delete button.
        const deleteItem = new PopupMenu.PopupMenuItem('Delete note');

        deleteItem.connect('activate', () => {
            this._onDelete(this._note);
        });

        this.menu.addMenuItem(deleteItem);
    }

    _makeToolButton(label) {
        return new St.Button({
            label,
            style_class: 'sticky-note-tool-button',
            can_focus: true,
            reactive: true,
        });
    }

    _lineStart(chars, position) {
        let start = Math.min(position, chars.length);

        while (start > 0 && chars[start - 1] !== '\n')
            start--;

        return start;
    }

    _lineEnd(chars, position) {
        let end = Math.min(position, chars.length);

        while (end < chars.length && chars[end] !== '\n')
            end++;

        return end;
    }

    // Handle Enter and list continuation.
    _handleEnter() {
        const text = this._text;

        const cursor = text.get_cursor_position();
        const bound = text.get_selection_bound();

        const start = Math.min(cursor, bound);
        const end = Math.max(cursor, bound);

        if (start !== end)
            text.delete_text(start, end);

        // Get the updated text after deleting any selection.
        const chars = Array.from(text.get_text());

        const lineStart = this._lineStart(chars, start);
        const lineEnd = this._lineEnd(chars, start);
        const line = chars.slice(lineStart, lineEnd).join('');

        let marker = '';

        if (line.startsWith('• '))
            marker = '• ';
        else if (line.startsWith('☐ ') || line.startsWith('☑ '))
            marker = line.slice(0, 2);

        // Normal Enter for non-list lines.
        if (!marker) {
            text.insert_text('\n', start);

            const newCursor = start + 1;
            text.set_cursor_position(newCursor);
            text.set_selection_bound(newCursor);

            return;
        }

        const markerLength = Array.from(marker).length;
        const content = line.slice(markerLength);

        // Empty list item: remove the marker to end the list.
        if (content.trim() === '') {
            text.delete_text(
                lineStart,
                lineStart + markerLength
            );

            text.set_cursor_position(lineStart);
            text.set_selection_bound(lineStart);
        } else {
            // Continue the list on the next line.
            const insertion = '\n' + marker;
            const newCursor = start + Array.from(insertion).length;

            text.insert_text(insertion, start);

            text.set_cursor_position(newCursor);
            text.set_selection_bound(newCursor);
        }
    }

    _insertMarker(marker) {
        const text = this._text;

        const cursor = text.get_cursor_position();
        const bound = text.get_selection_bound();

        const start = Math.min(cursor, bound);
        const end = Math.max(cursor, bound);

        if (start !== end)
            text.delete_text(start, end);

        text.insert_text(marker, start);

        const newCursor = start + Array.from(marker).length;

        text.set_cursor_position(newCursor);
        text.set_selection_bound(newCursor);

        text.grab_key_focus();
    }

    _toggleCheckbox() {
        const chars = Array.from(this._text.get_text());
        const cursor = this._text.get_cursor_position();

        const lineStart = this._lineStart(chars, cursor);

        this._toggleCheckboxAt(lineStart);
    }

    _toggleCheckboxAt(lineStart) {
        const text = this._text;
        const chars = Array.from(text.get_text());

        if (chars[lineStart] === '☐')
            chars[lineStart] = '☑';
        else if (chars[lineStart] === '☑')
            chars[lineStart] = '☐';
        else
            return;

        const cursor = text.get_cursor_position();
        const updated = chars.join('');

        text.set_text(updated);

        // Restore the cursor and clear the previous selection.
        text.set_cursor_position(cursor);
        text.set_selection_bound(cursor);

        text.grab_key_focus();
    }

    // Check whether the pointer is over this note or its popup.
    _pointerIsInside() {
        const [x, y] = global.get_pointer();

        let actor = global.stage.get_actor_at_pos(
            Clutter.PickMode.REACTIVE,
            x,
            y
        );

        while (actor) {
            if (actor === this ||
                actor === this.container ||
                actor === this.menu.actor ||
                actor === this._card) {
                return true;
            }

            actor = actor.get_parent();
        }

        return false;
    }

    _cancelClose() {
        if (this._closeTimeout) {
            GLib.source_remove(this._closeTimeout);
            this._closeTimeout = 0;
        }
    }

    _scheduleClose() {
        this._cancelClose();

        this._closeTimeout = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            350,
            () => {
                this._closeTimeout = 0;

                if (this._destroying)
                    return GLib.SOURCE_REMOVE;

                // Only close if the pointer has left both the dot
                // and the popup menu.
                if (!this._pointerIsInside() && this.menu.isOpen)
                    this.menu.close();

                return GLib.SOURCE_REMOVE;
            }
        );
    }

    destroy() {
        this._destroying = true;
        this._cancelClose();

        super.destroy();
    }
});

export default class StickyNotesExtension extends Extension {
    enable() {
        this._notes = [];
        this._buttons = [];
        this._nextId = 0;

        this._file = GLib.build_filenamev([
            GLib.get_user_data_dir(),
            'barstickynotes',
            'notes.json',
        ]);

        this._loadNotes();

        // Create all saved notes first.
        for (const note of this._notes)
            this._createNoteButton(note);

        // The plus button is always last.
        this._createAddButton();
    }

    disable() {
        for (const item of this._buttons)
            item.button.destroy();

        this._buttons = [];

        if (this._addButton) {
            this._addButton.destroy();
            this._addButton = null;
        }
    }

    _loadNotes() {
        try {
            const [success, contents] =
                GLib.file_get_contents(this._file);

            if (success) {
                const parsed = JSON.parse(
                    new TextDecoder().decode(contents)
                );

                if (Array.isArray(parsed)) {
                    this._notes = parsed
                        .filter(note =>
                            note && typeof note.text === 'string'
                        )
                        .map((note, index) => ({
                            text: note.text,
                            color: COLORS.includes(note.color)
                                ? note.color
                                : COLORS[index % COLORS.length],
                        }));
                }
            }
        } catch (error) {
            console.error(
                `Sticky Notes: Load failed: ${error}`
            );
        }

        if (this._notes.length === 0) {
            this._notes = [{
                text: '',
                color: COLORS[0],
            }];
        }
    }

    _saveNotes() {
        try {
            GLib.mkdir_with_parents(
                GLib.path_get_dirname(this._file),
                0o755
            );

            GLib.file_set_contents(
                this._file,
                JSON.stringify(this._notes)
            );
        } catch (error) {
            console.error(
                `Sticky Notes: Save failed: ${error}`
            );
        }
    }

    // Get the correct panel box.
    _getPanelBox() {
        return PANEL_BOX === 'left'
            ? Main.panel._leftBox
            : Main.panel._rightBox;
    }

    _createNoteButton(note) {
        const id = this._nextId++;

        const button = new StickyNote(
            note,
            () => this._saveNotes(),
            deleted => this._deleteNote(deleted)
        );

        this._buttons.push({
            note,
            button,
        });

        const panelBox = this._getPanelBox();
        const children = panelBox.get_children();

        // Insert immediately before the plus button if it exists.
        let position = children.length;

        if (this._addButton) {
            const addIndex = children.indexOf(
                this._addButton.container
            );

            if (addIndex !== -1)
                position = addIndex;
        }

        Main.panel.addToStatusArea(
            `${this.uuid}-note-${id}`,
            button,
            position,
            PANEL_BOX
        );
    }

    _createAddButton() {
        this._addButton = new PanelMenu.Button(
            0.5,
            'Add Sticky Note',
            true
        );

        const plus = new St.Button({
            label: '+',
            style_class: 'sticky-note-plus',
            can_focus: false,
        });

        plus.connect('clicked', () => {
            this._addNote();
        });

        this._addButton.add_child(plus);

        // Append the plus button after all notes.
        const position = this._getPanelBox().get_n_children();

        Main.panel.addToStatusArea(
            `${this.uuid}-add`,
            this._addButton,
            position,
            PANEL_BOX
        );
    }

    _addNote() {
        const note = {
            text: '',
            color: COLORS[this._notes.length % COLORS.length],
        };

        this._notes.push(note);

        this._saveNotes();
        this._createNoteButton(note);
    }

    _deleteNote(note) {
        const index = this._notes.indexOf(note);

        if (index === -1)
            return;

        this._notes.splice(index, 1);

        const buttonIndex = this._buttons.findIndex(
            item => item.note === note
        );

        if (buttonIndex !== -1) {
            this._buttons[buttonIndex].button.destroy();
            this._buttons.splice(buttonIndex, 1);
        }

        // Always keep at least one note.
        if (this._notes.length === 0) {
            const replacement = {
                text: '',
                color: COLORS[0],
            };

            this._notes.push(replacement);
            this._createNoteButton(replacement);
        }

        this._saveNotes();
    }
}

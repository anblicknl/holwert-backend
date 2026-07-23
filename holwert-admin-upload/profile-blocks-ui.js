/**
 * Gedeelde UI voor profielblokken (admin + optioneel hergebruik).
 */
(function (global) {
    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
    }

    function profileBlockServiceItemHtml(it, i, weekdayLabels) {
        const opts = (weekdayLabels || []).map((label, w) =>
            `<option value="${w}" ${Number(it?.weekday) === w ? 'selected' : ''}>${esc(label)}</option>`
        ).join('');
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-row">
                <div class="form-group"><label>Dag</label><select class="pb-weekday">${opts}</select></div>
                <div class="form-group"><label>Tijd</label><input type="time" class="pb-time" value="${esc(it?.time || '')}"></div>
            </div>
            <div class="form-group"><label>Titel</label><input type="text" class="pb-title" value="${esc(it?.title || '')}"></div>
            <div class="form-row">
                <div class="form-group"><label>Locatie</label><input type="text" class="pb-location" value="${esc(it?.location || '')}"></div>
                <div class="form-group"><label>Notitie</label><input type="text" class="pb-note" value="${esc(it?.note || '')}"></div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockMatchItemHtml(it, i) {
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-row">
                <div class="form-group"><label>Datum</label><input type="date" class="pb-date" value="${esc(it?.date || '')}"></div>
                <div class="form-group"><label>Tijd</label><input type="time" class="pb-time" value="${esc(it?.time || '')}"></div>
            </div>
            <div class="form-group"><label>Tegenstander</label><input type="text" class="pb-opponent" value="${esc(it?.opponent || '')}"></div>
            <div class="form-row">
                <div class="form-group"><label>Locatie</label><input type="text" class="pb-location" value="${esc(it?.location || '')}"></div>
                <div class="form-group"><label>Competitie</label><input type="text" class="pb-competition" value="${esc(it?.competition || '')}"></div>
            </div>
            <label class="checkbox-label"><input type="checkbox" class="pb-is-home" ${it?.is_home !== false ? 'checked' : ''}> Thuiswedstrijd</label>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockKvItemHtml(it, i) {
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-row">
                <div class="form-group"><label>Label</label><input type="text" class="pb-label" value="${esc(it?.label || '')}"></div>
                <div class="form-group"><label>Waarde</label><input type="text" class="pb-value" value="${esc(it?.value || '')}"></div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockFacilityItemHtml(it, i) {
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-group"><label>Naam</label><input type="text" class="pb-label" value="${esc(it?.label || '')}"></div>
            <div class="form-group"><label>Toelichting</label><input type="text" class="pb-text" value="${esc(it?.text || '')}"></div>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockTeamItemHtml(it, i) {
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-row">
                <div class="form-group"><label>Naam</label><input type="text" class="pb-name" value="${esc(it?.name || '')}"></div>
                <div class="form-group"><label>Rol</label><input type="text" class="pb-role" value="${esc(it?.role || '')}"></div>
            </div>
            <div class="form-group"><label>Notitie</label><input type="text" class="pb-note" value="${esc(it?.note || '')}"></div>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockLinkItemHtml(it, i) {
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-row">
                <div class="form-group"><label>Label</label><input type="text" class="pb-label" value="${esc(it?.label || '')}"></div>
                <div class="form-group"><label>URL</label><input type="url" class="pb-url" value="${esc(it?.url || '')}"></div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockFormHtml(blockType, data, weekdayLabels) {
        const days = Array.isArray(data?.days) ? data.days : [];
        const items = Array.isArray(data?.items) ? data.items : [];
        switch (blockType) {
            case 'opening_hours':
                return `
                    <div class="form-group">
                        <label>Notitie (optioneel)</label>
                        <input type="text" id="pb_note" value="${esc(data?.note || '')}" maxlength="500" placeholder="Bijv. alleen op afspraak">
                    </div>
                    <div class="form-group">
                        <label>Weekschema</label>
                        ${(weekdayLabels || []).map((label, day) => {
                            const d = days.find((x) => Number(x.day) === day) || { day, closed: true };
                            return `<div class="form-row" style="align-items:center;margin-bottom:8px;">
                                <label class="checkbox-label" style="min-width:110px;margin:0;">
                                    <input type="checkbox" class="pb-day-closed" data-day="${day}" ${d.closed ? 'checked' : ''}> ${esc(label)}
                                </label>
                                <input type="time" class="pb-day-open" data-day="${day}" value="${esc(d.open || '09:00')}" ${d.closed ? 'disabled' : ''} style="flex:1;">
                                <span style="padding:0 6px;">–</span>
                                <input type="time" class="pb-day-close" data-day="${day}" value="${esc(d.close || '17:00')}" ${d.closed ? 'disabled' : ''} style="flex:1;">
                            </div>`;
                        }).join('')}
                    </div>`;
            case 'service_schedule':
                return `
                    <div id="pb_items_wrap">${items.map((it, i) => profileBlockServiceItemHtml(it, i, weekdayLabels)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Dienst toevoegen</button>`;
            case 'match_schedule':
                return `
                    <div id="pb_items_wrap">${items.map((it, i) => profileBlockMatchItemHtml(it, i)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Wedstrijd toevoegen</button>`;
            case 'membership':
                return `
                    <div class="form-group"><label>Intro</label><textarea id="pb_intro" rows="3">${esc(data?.intro || '')}</textarea></div>
                    <div class="form-row">
                        <div class="form-group"><label>Contributie / tarief</label><input type="text" id="pb_fee" value="${esc(data?.fee || '')}"></div>
                        <div class="form-group"><label>Contact</label><input type="text" id="pb_contact" value="${esc(data?.contact || '')}"></div>
                    </div>
                    <div class="form-group"><label>Aanmeld-URL</label><input type="url" id="pb_signup_url" value="${esc(data?.signup_url || '')}" placeholder="https://…"></div>
                    <div id="pb_items_wrap">${(data?.items || []).map((it, i) => profileBlockKvItemHtml(it, i)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Regel toevoegen</button>`;
            case 'facilities':
                return `
                    <div id="pb_items_wrap">${items.map((it, i) => profileBlockFacilityItemHtml(it, i)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Voorziening toevoegen</button>`;
            case 'team':
                return `
                    <div id="pb_items_wrap">${items.map((it, i) => profileBlockTeamItemHtml(it, i)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Persoon toevoegen</button>`;
            case 'links':
                return `
                    <div id="pb_items_wrap">${items.map((it, i) => profileBlockLinkItemHtml(it, i)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Link toevoegen</button>`;
            case 'notice':
                return `
                    <div class="form-group"><label>Mededeling</label><textarea id="pb_text" rows="4" maxlength="500">${esc(data?.text || '')}</textarea></div>
                    <div class="form-group"><label>Tot en met (optioneel)</label><input type="date" id="pb_until" value="${esc(data?.until || '')}"><p class="form-hint">Na deze datum verdwijnt de mededeling automatisch uit de app.</p></div>`;
            default:
                return '<p class="form-hint">Onbekend bloktype.</p>';
        }
    }

    function wireProfileBlockForm(overlay, blockType, meta) {
        overlay.querySelectorAll('.pb-day-closed').forEach((cb) => {
            cb.addEventListener('change', () => {
                const day = cb.getAttribute('data-day');
                const open = overlay.querySelector(`.pb-day-open[data-day="${day}"]`);
                const close = overlay.querySelector(`.pb-day-close[data-day="${day}"]`);
                if (open) open.disabled = cb.checked;
                if (close) close.disabled = cb.checked;
            });
        });
        overlay.querySelector('#pb_add_item')?.addEventListener('click', () => {
            const wrap = overlay.querySelector('#pb_items_wrap');
            if (!wrap) return;
            const idx = wrap.querySelectorAll('.profile-block-item').length;
            let html = '';
            if (blockType === 'service_schedule') html = profileBlockServiceItemHtml({}, idx, meta?.weekday_labels);
            else if (blockType === 'match_schedule') html = profileBlockMatchItemHtml({}, idx);
            else if (blockType === 'membership') html = profileBlockKvItemHtml({}, idx);
            else if (blockType === 'facilities') html = profileBlockFacilityItemHtml({}, idx);
            else if (blockType === 'team') html = profileBlockTeamItemHtml({}, idx);
            else if (blockType === 'links') html = profileBlockLinkItemHtml({}, idx);
            if (!html) return;
            const div = document.createElement('div');
            div.innerHTML = html;
            const node = div.firstElementChild;
            wrap.appendChild(node);
            node.querySelector('.pb-remove-item')?.addEventListener('click', () => node.remove());
        });
        overlay.querySelectorAll('.pb-remove-item').forEach((btn) => {
            btn.addEventListener('click', () => btn.closest('.profile-block-item')?.remove());
        });
    }

    function collectProfileBlockData(overlay, blockType) {
        switch (blockType) {
            case 'opening_hours': {
                const days = [];
                for (let day = 0; day <= 6; day++) {
                    const closed = overlay.querySelector(`.pb-day-closed[data-day="${day}"]`)?.checked;
                    days.push({
                        day,
                        closed: !!closed,
                        open: overlay.querySelector(`.pb-day-open[data-day="${day}"]`)?.value || '09:00',
                        close: overlay.querySelector(`.pb-day-close[data-day="${day}"]`)?.value || '17:00',
                    });
                }
                return { note: overlay.querySelector('#pb_note')?.value?.trim() || '', days, exceptions: [] };
            }
            case 'service_schedule':
                return {
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        weekday: parseInt(el.querySelector('.pb-weekday')?.value, 10) || 0,
                        time: el.querySelector('.pb-time')?.value || '',
                        title: el.querySelector('.pb-title')?.value?.trim() || '',
                        location: el.querySelector('.pb-location')?.value?.trim() || '',
                        note: el.querySelector('.pb-note')?.value?.trim() || '',
                    })),
                };
            case 'match_schedule':
                return {
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        date: el.querySelector('.pb-date')?.value || '',
                        time: el.querySelector('.pb-time')?.value || '',
                        opponent: el.querySelector('.pb-opponent')?.value?.trim() || '',
                        location: el.querySelector('.pb-location')?.value?.trim() || '',
                        is_home: el.querySelector('.pb-is-home')?.checked !== false,
                        competition: el.querySelector('.pb-competition')?.value?.trim() || '',
                    })),
                };
            case 'membership':
                return {
                    intro: overlay.querySelector('#pb_intro')?.value?.trim() || '',
                    fee: overlay.querySelector('#pb_fee')?.value?.trim() || '',
                    contact: overlay.querySelector('#pb_contact')?.value?.trim() || '',
                    signup_url: overlay.querySelector('#pb_signup_url')?.value?.trim() || '',
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        label: el.querySelector('.pb-label')?.value?.trim() || '',
                        value: el.querySelector('.pb-value')?.value?.trim() || '',
                    })),
                };
            case 'facilities':
                return {
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        label: el.querySelector('.pb-label')?.value?.trim() || '',
                        text: el.querySelector('.pb-text')?.value?.trim() || '',
                    })),
                };
            case 'team':
                return {
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        name: el.querySelector('.pb-name')?.value?.trim() || '',
                        role: el.querySelector('.pb-role')?.value?.trim() || '',
                        note: el.querySelector('.pb-note')?.value?.trim() || '',
                    })),
                };
            case 'links':
                return {
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        label: el.querySelector('.pb-label')?.value?.trim() || '',
                        url: el.querySelector('.pb-url')?.value?.trim() || '',
                        icon: 'link',
                    })),
                };
            case 'notice':
                return {
                    text: overlay.querySelector('#pb_text')?.value?.trim() || '',
                    until: overlay.querySelector('#pb_until')?.value || '',
                };
            default:
                return {};
        }
    }

    /**
     * @param {{ meta: object, existingBlock?: object|null, onSave: (payload: object) => Promise<void> }} options
     */
    function openBlockEditorModal(options) {
        const { meta: rawMeta, existingBlock, onSave } = options;
        const fallbackTypes = [
            { id: 'opening_hours', label: 'Openingstijden' },
            { id: 'service_schedule', label: 'Diensten / vieringen' },
            { id: 'match_schedule', label: 'Speelschema' },
            { id: 'membership', label: 'Lidmaatschap' },
            { id: 'facilities', label: 'Voorzieningen' },
            { id: 'team', label: 'Team / bestuur' },
            { id: 'links', label: 'Handige links' },
            { id: 'notice', label: 'Mededeling' },
        ];
        const meta = {
            block_types: Array.isArray(rawMeta?.block_types) && rawMeta.block_types.length ? rawMeta.block_types : fallbackTypes,
            weekday_labels: Array.isArray(rawMeta?.weekday_labels) && rawMeta.weekday_labels.length
                ? rawMeta.weekday_labels
                : ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'],
            suggested_types: Array.isArray(rawMeta?.suggested_types) && rawMeta.suggested_types.length
                ? rawMeta.suggested_types
                : ['notice', 'links', 'facilities'],
        };
        const existing = existingBlock || null;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show modal-stack-top';
        overlay.style.display = 'flex';
        const typeOptions = (meta.block_types || []).map((t) =>
            `<option value="${esc(t.id)}" ${existing?.block_type === t.id ? 'selected' : ''}>${esc(t.label)}</option>`
        ).join('');
        const initialType = existing?.block_type || meta.suggested_types?.[0] || meta.block_types?.[0]?.id || 'notice';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:640px;">
                <div class="modal-header">
                    <h3>${existing ? 'Profielblok bewerken' : 'Nieuw profielblok'}</h3>
                    <button type="button" class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="pb_title">Titel</label>
                        <input type="text" id="pb_title" maxlength="255" value="${esc(existing?.title || '')}">
                    </div>
                    <div class="form-group">
                        <label for="pb_block_type">Type</label>
                        <select id="pb_block_type" ${existing ? 'disabled' : ''}>${typeOptions}</select>
                        ${existing ? '<p class="form-hint">Het type kan na aanmaken niet meer worden gewijzigd.</p>' : ''}
                    </div>
                    <label class="checkbox-label"><input type="checkbox" id="pb_visible" ${existing?.is_visible === false ? '' : 'checked'}> Zichtbaar in de app</label>
                    <div id="pb_form_body" style="margin-top:1rem;"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary modal-close-btn">Annuleren</button>
                    <button type="button" class="btn btn-primary" id="pb_save_btn">Opslaan</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const renderFormBody = () => {
            const type = existing?.block_type || overlay.querySelector('#pb_block_type')?.value || initialType;
            const data = existing?.data || {};
            const body = overlay.querySelector('#pb_form_body');
            if (body) {
                body.innerHTML = profileBlockFormHtml(type, data, meta.weekday_labels);
                wireProfileBlockForm(overlay, type, meta);
            }
        };
        renderFormBody();
        if (!existing) {
            overlay.querySelector('#pb_block_type')?.addEventListener('change', renderFormBody);
        }

        const close = () => overlay.remove();
        overlay.querySelector('.modal-close')?.addEventListener('click', close);
        overlay.querySelector('.modal-close-btn')?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        overlay.querySelector('#pb_save_btn')?.addEventListener('click', async () => {
            const title = overlay.querySelector('#pb_title')?.value?.trim();
            if (!title) {
                alert('Titel is verplicht');
                return;
            }
            const blockType = existing?.block_type || overlay.querySelector('#pb_block_type')?.value;
            const payload = {
                title,
                data: collectProfileBlockData(overlay, blockType),
                is_visible: overlay.querySelector('#pb_visible')?.checked !== false,
            };
            if (!existing) payload.block_type = blockType;
            try {
                await onSave(payload);
                close();
            } catch (err) {
                alert(err.message || 'Opslaan mislukt');
            }
        });
    }

    global.HolwertProfileBlocksUi = {
        esc,
        openBlockEditorModal,
    };
})(typeof window !== 'undefined' ? window : globalThis);

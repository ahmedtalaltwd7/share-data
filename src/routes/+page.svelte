<script>
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';

	const DB_NAME = 'DataTransferDB';
	const STORE_NAME = 'receivedData';
	const SAVED_STORE_NAME = 'savedData';
	const emptyForm = () => ({ fullName: '', email: '', phone: '', subject: '', message: '' });

	let form = $state(emptyForm());
	let shareUrl = $state('');
	let qrImage = $state('');
	let records = $state([]);
	let savedRecords = $state([]);
	let selectedIds = $state([]);
	let selected = $state(null);
	let activeTab = $state('share');
	let busy = $state(false);
	let notice = $state(null);
	let db;
	let noticeTimer;

	function notify(message, kind = 'success') {
		notice = { message, kind };
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = null), 4800);
	}

	function openDatabase() {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, 3);
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(STORE_NAME)) {
					database.createObjectStore(STORE_NAME, { keyPath: 'id' });
				}
				if (!database.objectStoreNames.contains(SAVED_STORE_NAME)) {
					database.createObjectStore(SAVED_STORE_NAME, { keyPath: 'id' });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new Error('Close other tabs using this app and try again.'));
		});
	}

	function allRecords() {
		return new Promise((resolve, reject) => {
			const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
			request.onsuccess = () => resolve(request.result
				.map((record) => ({ ...record, receivedDate: record.receivedDate || new Date(record.receivedAt || 0).toISOString() }))
				.sort((a, b) => b.receivedDate.localeCompare(a.receivedDate)));
			request.onerror = () => reject(request.error);
		});
	}

	function allSavedRecords() {
		return new Promise((resolve, reject) => {
			const request = db.transaction(SAVED_STORE_NAME, 'readonly').objectStore(SAVED_STORE_NAME).getAll();
			request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
			request.onerror = () => reject(request.error);
		});
	}

	async function refreshRecords() {
		[records, savedRecords] = await Promise.all([allRecords(), allSavedRecords()]);
		if (selected) selected = records.find((record) => record.id === selected.id) || null;
	}

	function isValidRecord(data) {
		return data !== null && typeof data === 'object' && !Array.isArray(data) &&
			typeof data.id === 'string' && /^[\w-]{8,80}$/.test(data.id) &&
			typeof data.fullName === 'string' && data.fullName.trim().length > 0 && data.fullName.length <= 200 &&
			typeof data.email === 'string' && data.email.length <= 320 &&
			(!data.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) &&
			typeof data.phone === 'string' && data.phone.length <= 80 &&
			typeof data.subject === 'string' && data.subject.length <= 200 &&
			typeof data.message === 'string' && data.message.length <= 10000;
	}

	function decodePayload(payload) {
		if (!payload || payload.length > 1000000 || !/^[\w-]+$/.test(payload)) {
			throw new Error('The sharing link contains invalid data.');
		}
		const base64 = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - payload.length % 4) % 4);
		const binary = atob(base64);
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	}

	function storeRecords(incomingRecords) {
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			let imported = 0;
			for (const record of incomingRecords) {
				const request = store.add({ ...record, receivedDate: new Date().toISOString() });
				request.onsuccess = () => imported += 1;
				request.onerror = (event) => {
					if (request.error?.name === 'ConstraintError') {
						event.preventDefault();
						event.stopPropagation();
					}
				};
			}
			transaction.oncomplete = () => resolve(imported);
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error || new Error('Could not save these records.'));
		});
	}

	async function receiveFromLink() {
		const fragment = new URLSearchParams(window.location.hash.slice(1));
		if (!fragment.has('data')) return;
		busy = true;
		activeTab = 'inbox';
		try {
			const data = decodePayload(fragment.get('data'));
			const incomingRecords = Array.isArray(data?.records) ? data.records : [data];
			if (!incomingRecords.length || !incomingRecords.every(isValidRecord)) {
				throw new Error('The shared information is incomplete or invalid.');
			}
			const imported = await storeRecords(incomingRecords);
			await refreshRecords();
			window.history.replaceState(null, '', window.location.pathname + window.location.search);
			activeTab = 'inbox';
			selected = null;
			const duplicates = incomingRecords.length - imported;
			notify(
				imported === 1 && duplicates === 0
					? 'Data received and saved successfully!'
					: imported > 0
						? `${imported} record${imported === 1 ? '' : 's'} saved successfully${duplicates ? `; ${duplicates} already existed` : ''}.`
						: 'These records were already received. Your saved copies were not changed.'
			);
		} catch (error) {
			notify(error instanceof SyntaxError ? 'This sharing link is malformed.' : (error.message || 'Could not save the shared information.'), 'error');
		} finally {
			busy = false;
		}
	}

	function encodeBase64Url(value) {
		const bytes = new TextEncoder().encode(value);
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
	}

	async function saveForm(event) {
		event.preventDefault();
		if (!form.fullName.trim()) {
			notify('Please enter a full name.', 'error');
			return;
		}
		if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
			notify('Please enter a valid email address.', 'error');
			return;
		}
		busy = true;
		try {
			const data = { id: crypto.randomUUID(), ...form, createdAt: Date.now() };
			await new Promise((resolve, reject) => {
				const request = db.transaction(SAVED_STORE_NAME, 'readwrite').objectStore(SAVED_STORE_NAME).add(data);
				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});
			await refreshRecords();
			form = emptyForm();
			shareUrl = '';
			qrImage = '';
			notify('Record saved on this device.');
		} catch {
			notify('Could not save this record. Please try again.', 'error');
		} finally {
			busy = false;
		}
	}

	async function generateLink() {
		const chosen = savedRecords.filter((record) => selectedIds.includes(record.id));
		if (!chosen.length) {
			notify('Select at least one saved record to share.', 'error');
			return;
		}
		busy = true;
		try {
			const payload = encodeBase64Url(JSON.stringify({
				records: chosen.map(({ id, fullName, email, phone, subject, message }) => ({
					id, fullName, email, phone, subject, message
				}))
			}));
			shareUrl = `${window.location.origin}${window.location.pathname}${window.location.search}#data=${payload}`;
			try {
				qrImage = await QRCode.toDataURL(shareUrl, {
					width: 192,
					margin: 1,
					color: { dark: '#173b30', light: '#ffffff' },
					errorCorrectionLevel: 'L'
				});
				notify('Sharing link created.');
			} catch {
				qrImage = '';
				notify('Link created, but it is too large for a QR code. Copy the link to share it.');
			}
		} catch (error) {
			notify(error.message || 'Could not create the sharing link.', 'error');
		} finally {
			busy = false;
		}
	}

	function toggleSelectedRecord(id, checked) {
		selectedIds = checked
			? [...new Set([...selectedIds, id])]
			: selectedIds.filter((selectedId) => selectedId !== id);
		shareUrl = '';
		qrImage = '';
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(shareUrl);
			notify('Link copied to clipboard.');
		} catch {
			notify('Clipboard access is unavailable. Select and copy the link manually.', 'error');
		}
	}

	function resetForm() {
		form = emptyForm();
		shareUrl = '';
		qrImage = '';
	}

	async function deleteSavedRecord(id) {
		try {
			await new Promise((resolve, reject) => {
				const request = db.transaction(SAVED_STORE_NAME, 'readwrite').objectStore(SAVED_STORE_NAME).delete(id);
				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});
			selectedIds = selectedIds.filter((selectedId) => selectedId !== id);
			shareUrl = '';
			qrImage = '';
			await refreshRecords();
			notify('Saved record deleted.');
		} catch {
			notify('Could not delete this saved record.', 'error');
		}
	}

	async function deleteRecord(id) {
		try {
			await new Promise((resolve, reject) => {
				const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});
			selected = null;
			await refreshRecords();
			notify('Record deleted.');
		} catch {
			notify('Could not delete this record.', 'error');
		}
	}

	async function clearRecords() {
		try {
			await new Promise((resolve, reject) => {
				const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});
			selected = null;
			await refreshRecords();
			notify('All received records cleared.');
		} catch {
			notify('Could not clear your records.', 'error');
		}
	}

	function exportRecords() {
		try {
			const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'received-data.json';
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			notify('Records exported as JSON.');
		} catch {
			notify('Could not export your records.', 'error');
		}
	}

	onMount(async () => {
		try {
			db = await openDatabase();
			await refreshRecords();
			await receiveFromLink();
		} catch (error) {
			notify(error.message || 'Your browser could not open local storage.', 'error');
		}
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js').catch(() => {
				notify('Offline app support could not be enabled.', 'error');
			});
		}
	});
</script>

<svelte:head>
	<title>Passalong - Share information privately</title>
	<meta name="description" content="Share information directly between browsers with a private, client-side link." />
	<meta name="theme-color" content="#f5f7f4" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<link rel="manifest" href="/manifest.webmanifest" />
</svelte:head>

<div class="app-shell">
	<header class="topbar">
		<a class="brand" href="/" aria-label="Passalong home"><span class="brand-mark">↗</span> passalong</a>
		<div class="privacy-label"><span></span> Private by design</div>
	</header>

	<main>
		<section class="hero">
			<div class="eyebrow">SIMPLE, PRIVATE SHARING</div>
			<h1>Information, <span>in good hands.</span></h1>
			<p>Send details from one browser to another. No accounts, no uploads, just a link.</p>
		</section>

		<div class="workspace">
			<nav class="tabs" aria-label="Workspace">
				<button class:active={activeTab === 'share'} onclick={() => { activeTab = 'share'; selected = null; }}>Create a link</button>
				<button class:active={activeTab === 'inbox'} onclick={() => { activeTab = 'inbox'; selected = null; }}>Received <span class="count">{records.length}</span></button>
			</nav>

			<section class="content-panel">
				{#if activeTab === 'share'}
					<div class="panel-heading">
						<div><div class="kicker">SAVE, THEN SHARE</div><h2>Build your records</h2><p>Save each entry here, then select any records to share together.</p></div>
					</div>
					<form onsubmit={saveForm}>
						<div class="form-grid">
							<label class="field"><span>Full name <b>Required</b></span><input bind:value={form.fullName} type="text" placeholder="e.g. Alex Morgan" maxlength="200" autocomplete="name" required /></label>
							<label class="field"><span>Email <b>Optional</b></span><input bind:value={form.email} type="email" placeholder="alex@example.com" maxlength="320" autocomplete="email" /></label>
							<label class="field"><span>Phone number <b>Optional</b></span><input bind:value={form.phone} type="tel" placeholder="+1 (555) 000-0000" maxlength="80" autocomplete="tel" /></label>
							<label class="field"><span>Subject <b>Optional</b></span><input bind:value={form.subject} type="text" placeholder="What is this about?" maxlength="200" /></label>
						</div>
						<label class="field message-field"><span>Message <b>Optional</b></span><textarea bind:value={form.message} placeholder="Add any extra details here..." maxlength="10000" rows="5"></textarea></label>
						<div class="form-actions">
							<button class="primary-button" type="submit" disabled={busy}>{busy ? 'Saving record...' : 'Save record'} <span>＋</span></button>
							<button class="secondary-button" type="button" onclick={resetForm}>Reset form</button>
						</div>
					</form>

					<section class="saved-section" aria-label="Saved records">
						<div class="saved-heading">
							<div><strong>Saved records</strong><span>{savedRecords.length} on this device</span></div>
							<button class="share-selected" onclick={generateLink} disabled={!selectedIds.length || busy}>Share selected ({selectedIds.length}) <span>↗</span></button>
						</div>
						{#if savedRecords.length}
							<div class="saved-list">
								{#each savedRecords as record}
									<div class="saved-row">
										<input type="checkbox" checked={selectedIds.includes(record.id)} aria-label={`Select ${record.fullName} to share`} onchange={(event) => toggleSelectedRecord(record.id, event.currentTarget.checked)} />
										<span class="record-main"><strong>{record.fullName}</strong><span>{record.subject || record.email || 'Saved information'}</span></span>
										<button class="saved-delete" type="button" aria-label={`Delete saved record ${record.fullName}`} onclick={() => deleteSavedRecord(record.id)}>×</button>
									</div>
								{/each}
							</div>
						{:else}
							<p class="saved-empty">Saved records will appear here. Select one or more to create a share link.</p>
						{/if}
					</section>

					{#if shareUrl}
						<section class="share-result" aria-label="Generated sharing link">
							<div class="result-heading"><div><div class="kicker">READY TO SHARE</div><h3>Your link is ready</h3><p>{selectedIds.length} record{selectedIds.length === 1 ? '' : 's'} included</p></div><span class="ready"><span></span> READY</span></div>
							<div class="result-content">
								<div class="link-column">
									<label class="field"><span>SHAREABLE LINK</span><input class="link-input" readonly value={shareUrl} aria-label="Generated sharing link" /></label>
									<button class="copy-button" onclick={copyLink}>Copy link</button>
									<p class="link-note">Anyone with this link can view the information. Base64 is not encryption.</p>
								</div>
								{#if qrImage}<div class="qr-column"><img src={qrImage} alt="QR code for your sharing link" /><span>SCAN TO OPEN</span></div>{:else}<p class="qr-unavailable">This link is too large for a QR code.</p>{/if}
							</div>
						</section>
					{/if}
				{:else if selected}
					<div class="panel-heading detail-heading"><div><div class="kicker">RECEIVED INFORMATION</div><h2>{selected.fullName}</h2><p>Received {new Date(selected.receivedDate).toLocaleString()}</p></div><button class="secondary-button" onclick={() => (selected = null)}>All records</button></div>
					<article class="record-detail">
						{#each [{ label: 'Email', value: selected.email }, { label: 'Phone number', value: selected.phone }, { label: 'Subject', value: selected.subject }, { label: 'Message', value: selected.message }] as item}
							<div class="detail-row"><span>{item.label}</span><p>{item.value || '-'}</p></div>
						{/each}
						<button class="delete-button" onclick={() => deleteRecord(selected.id)}>Delete record</button>
					</article>
				{:else}
					<div class="panel-heading inbox-heading">
						<div><div class="kicker">YOUR PRIVATE INBOX</div><h2>Received information <span class="heading-count">{records.length}</span></h2><p>Links you open are saved on this device only.</p></div>
						<div class="inbox-actions"><button class="export-button" onclick={exportRecords} disabled={!records.length}>Export JSON</button>{#if records.length}<button class="clear-button" onclick={clearRecords}>Clear all</button>{/if}</div>
					</div>
					{#if busy}
						<div class="empty-state"><span class="spinner"></span> Saving shared information...</div>
					{:else if records.length}
						<div class="records-list">
							{#each records as record}
								<div class="record-row">
									<button class="record-open" onclick={() => (selected = record)}><span class="record-avatar">{record.fullName.slice(0, 1).toUpperCase()}</span><span class="record-main"><strong>{record.fullName}</strong><span>{record.subject || record.email || 'Shared information'}</span></span><span class="record-date">{new Date(record.receivedDate).toLocaleDateString()}</span></button>
									<button class="row-delete" aria-label={`Delete ${record.fullName}`} onclick={() => deleteRecord(record.id)}>×</button>
								</div>
							{/each}
						</div>
					{:else}
						<div class="empty-state"><div class="empty-icon">↓</div><h3>Your inbox is clear</h3><p>When someone shares a link with you, the information will appear here.</p><button class="primary-button" onclick={() => (activeTab = 'share')}>Create a sharing link <span>↗</span></button></div>
					{/if}
				{/if}
			</section>
		</div>

		<footer><span>PASSALONG <b>·</b> PRIVATE SHARING</span><span>Information is carried in the link and never uploaded.</span></footer>
	</main>
</div>

{#if notice}<div class="toast" class:error={notice.kind === 'error'} role="status" aria-live="polite"><span>{notice.kind === 'error' ? '!' : '✓'}</span>{notice.message}<button aria-label="Dismiss notification" onclick={() => (notice = null)}>×</button></div>{/if}

<style>
	:global(*){box-sizing:border-box}
	:global(body){margin:0;background:#f5f7f4;color:#20342b;font-family:Inter,"Segoe UI",sans-serif;font-size:14px}
	:global(button),:global(input),:global(textarea){font:inherit}
	:global(button){cursor:pointer}
	:global(button:focus-visible),:global(input:focus-visible),:global(textarea:focus-visible){outline:3px solid #9dc9aa;outline-offset:2px}
	.app-shell{min-height:100vh}
	.topbar{height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 max(24px,calc((100vw - 1060px)/2));border-bottom:1px solid #e8ede8;background:#fbfcfa}
	.brand{display:flex;align-items:center;gap:9px;color:#1c3d30;text-decoration:none;font-size:18px;font-weight:750;letter-spacing:-.7px}
	.brand-mark{display:grid;place-items:center;width:27px;height:27px;border-radius:8px;background:#dceddf;color:#246246;font-size:18px}
	.privacy-label{display:flex;align-items:center;gap:8px;color:#607368;font-size:12px}
	.privacy-label span,.ready span{width:7px;height:7px;border-radius:50%;background:#56a878}
	main{max-width:1060px;margin:0 auto;padding:56px 24px 24px}
	.hero{text-align:center;margin:0 auto 34px}
	.eyebrow,.kicker{color:#528169;font-size:10px;font-weight:750;letter-spacing:1.15px}
	.hero h1{margin:12px 0 8px;font-size:clamp(30px,5vw,43px);line-height:1.12;letter-spacing:-1.8px;font-weight:740}
	.hero h1 span{color:#4b8064}
	.hero p{margin:0;color:#6b7b72;font-size:14px}
	.workspace{max-width:800px;margin:0 auto;border:1px solid #e4e9e3;border-radius:12px;background:#fff;box-shadow:0 12px 35px #20342b0a;overflow:hidden}
	.tabs{display:flex;gap:22px;padding:0 26px;border-bottom:1px solid #e9ede9;background:#fcfdfb}
	.tabs button{position:relative;display:flex;align-items:center;gap:8px;border:0;background:none;color:#78867d;padding:17px 2px;font-size:12px;font-weight:650}
	.tabs button.active{color:#285d42}
	.tabs button.active:after{position:absolute;content:"";height:2px;bottom:-1px;left:0;right:0;background:#40805a}
	.count,.heading-count{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:12px;background:#edf3ee;color:#4f715c;font-size:10px}
	.content-panel{padding:27px 30px 30px}
	.panel-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
	.panel-heading h2{margin:6px 0 5px;font-size:21px;letter-spacing:-.45px}
	.panel-heading p{margin:0;color:#7a877e;font-size:12px}
	.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px 18px}
	.field{display:flex;flex-direction:column;gap:7px;min-width:0}
	.field>span{display:flex;justify-content:space-between;align-items:center;color:#384b40;font-size:11px;font-weight:650}
	.field b{color:#94a097;font-size:9px;font-weight:500}
	.field input,.field textarea{width:100%;border:1px solid #dfe6df;border-radius:6px;background:#fdfefd;color:#263a30;padding:10px 11px;font-size:12px;transition:border-color .15s,box-shadow .15s}
	.field input{height:39px}
	.field textarea{resize:vertical;min-height:105px;line-height:1.5}
	.field input:focus,.field textarea:focus{border-color:#72a781;box-shadow:0 0 0 3px #72a78119;outline:none}
	.field input::placeholder,.field textarea::placeholder{color:#a7b0a9}
	.message-field{margin-top:17px}
	.form-actions{display:flex;align-items:center;gap:10px;margin-top:20px}
	.primary-button,.copy-button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:40px;padding:0 16px;border:1px solid #2c6848;border-radius:6px;background:#2c6848;color:white;font-size:11px;font-weight:680;transition:background .15s}
	.primary-button:hover,.copy-button:hover{background:#22573b}
	.primary-button:disabled{opacity:.6;cursor:wait}
	.primary-button span{font-size:15px}
	.secondary-button,.export-button,.clear-button{min-height:38px;padding:0 13px;border:1px solid #e0e7e1;border-radius:6px;background:white;color:#52655a;font-size:11px;font-weight:600}
	.secondary-button:hover,.export-button:hover,.clear-button:hover{background:#f5f8f5}
	.saved-section{margin-top:24px;padding-top:18px;border-top:1px solid #edf0ed}
	.saved-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
	.saved-heading>div{display:flex;align-items:baseline;gap:8px}
	.saved-heading strong{font-size:12px}
	.saved-heading>div>span,.saved-empty{color:#87938b;font-size:10px}
	.share-selected{min-height:34px;padding:0 11px;border:1px solid #dce8dd;border-radius:6px;background:#edf5ee;color:#35684a;font-size:10px;font-weight:650}
	.share-selected:disabled{opacity:.45;cursor:default}
	.saved-list{border-top:1px solid #edf0ed}
	.saved-row{display:flex;align-items:center;gap:10px;min-height:50px;padding:7px 4px;border-bottom:1px solid #edf0ed}
	.saved-row>input{width:15px;height:15px;flex:none;accent-color:#2c6848}
	.saved-row .record-main{padding:3px 0}
	.saved-delete{width:28px;height:28px;flex:none;border:0;border-radius:5px;background:transparent;color:#9c746c;font-size:19px}
	.saved-delete:hover{background:#faf0ee}
	.saved-empty{margin:0;padding:8px 0 2px}
	.share-result{margin-top:25px;padding:19px;border:1px solid #dfe9df;border-radius:8px;background:#f9fbf8}
	.result-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
	.result-heading h3{margin:5px 0 0;font-size:16px}
	.ready{display:flex;align-items:center;gap:6px;color:#578369;font-size:9px;font-weight:700;letter-spacing:.5px}
	.ready span{width:6px;height:6px}
	.result-content{display:flex;align-items:center;justify-content:space-between;gap:18px}
	.link-column{flex:1;min-width:0}
	.link-input{font-size:11px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
	.copy-button{min-height:34px;margin-top:9px;font-size:10px}
	.link-note{margin:10px 0 0;color:#7b887e;font-size:10px;line-height:1.5}
	.qr-column{display:flex;flex-direction:column;align-items:center;gap:7px;flex:none;color:#789081;font-size:8px;font-weight:700;letter-spacing:.7px}
	.qr-column img{width:136px;height:136px;padding:6px;border:1px solid #e5ebe5;border-radius:5px;background:white}
	.qr-unavailable{max-width:140px;margin:0;color:#7b887e;font-size:10px;text-align:center}
	.inbox-heading{align-items:flex-end}
	.inbox-actions{display:flex;gap:8px}
	.export-button:disabled{opacity:.45;cursor:default}
	.clear-button{color:#9a574c}
	.records-list{border-top:1px solid #edf0ed}
	.record-row{display:flex;align-items:center;border-bottom:1px solid #edf0ed;gap:8px}
	.record-open{flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:12px 5px;border:0;background:white;text-align:left}
	.record-open:hover .record-main strong{color:#377450}
	.record-avatar{display:grid;place-items:center;width:34px;height:34px;flex:none;border-radius:50%;background:#e8f1e9;color:#43805b;font-weight:700}
	.record-main{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}
	.record-main strong{overflow:hidden;color:#31453a;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
	.record-main span{overflow:hidden;color:#87938b;font-size:10px;text-overflow:ellipsis;white-space:nowrap}
	.record-date{color:#929d94;font-size:10px}
	.row-delete{width:30px;height:30px;border:0;background:transparent;color:#9c746c;font-size:20px}
	.row-delete:hover{border-radius:5px;background:#faf0ee}
	.empty-state{display:flex;flex-direction:column;align-items:center;padding:36px 12px 28px;text-align:center;color:#829087;font-size:12px}
	.empty-icon{display:grid;place-items:center;width:42px;height:42px;margin-bottom:9px;border-radius:12px;background:#eef4ee;color:#528169;font-size:24px}
	.empty-state h3{margin:4px 0;color:#3b4e43;font-size:15px}
	.empty-state p{max-width:320px;margin:4px 0 18px;line-height:1.6}
	.empty-state .primary-button{min-height:36px}
	.detail-heading{align-items:flex-start}
	.record-detail{border-top:1px solid #edf0ed;padding-top:5px}
	.detail-row{display:grid;grid-template-columns:130px minmax(0,1fr);gap:10px;padding:13px 4px;border-bottom:1px solid #edf0ed}
	.detail-row>span{color:#829087;font-size:11px}
	.detail-row p{margin:0;color:#33483b;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
	.delete-button{margin-top:18px;padding:8px 11px;border:1px solid #f0dfdc;border-radius:5px;background:#fffafa;color:#9a574c;font-size:10px}
	.empty-state .spinner{width:22px;height:22px;margin-bottom:12px;border:2px solid #dce8dd;border-top-color:#528169;border-radius:50%;animation:spin .8s linear infinite}
	@keyframes spin{to{transform:rotate(360deg)}}
	footer{display:flex;justify-content:space-between;gap:15px;max-width:800px;margin:19px auto 0;color:#829087;font-size:9px}
	footer>span:first-child{font-weight:700;letter-spacing:.7px}
	footer b{color:#5c956e}
	.toast{position:fixed;right:22px;bottom:22px;z-index:5;display:flex;align-items:center;gap:10px;max-width:min(440px,calc(100vw - 32px));padding:12px 14px;border:1px solid #dbe8dc;border-radius:8px;background:#fff;color:#355944;box-shadow:0 8px 28px #1f382b18;font-size:12px}
	.toast>span{display:grid;place-items:center;width:20px;height:20px;flex:none;border-radius:50%;background:#e7f2e8;color:#3f8055;font-weight:700}
	.toast.error{border-color:#f0d9d4;color:#985448}
	.toast.error>span{background:#f9ece9;color:#a55345}
	.toast button{margin-left:auto;border:0;background:none;color:inherit;font-size:17px}
	@media(max-width:640px){
		main{padding:36px 14px 20px}
		.topbar{height:58px;padding:0 16px}
		.hero{margin-bottom:24px}
		.hero h1{letter-spacing:-1.2px}
		.hero p{max-width:340px;margin:0 auto;font-size:12px;line-height:1.55}
		.content-panel{padding:22px 18px}
		.tabs{padding:0 18px}
		.form-grid{grid-template-columns:1fr;gap:14px}
		.inbox-heading{align-items:flex-start;flex-direction:column;gap:14px}
		.result-content{align-items:flex-start}
		.qr-column img{width:108px;height:108px}
		.share-result{padding:15px}
		.detail-row{grid-template-columns:95px minmax(0,1fr)}
		footer{flex-direction:column;align-items:center;text-align:center;margin-top:16px}
	}
	@media(max-width:400px){
		.privacy-label{font-size:10px}
		.result-content{flex-direction:column}
		.qr-column{align-self:center}
		.form-actions{align-items:stretch;flex-direction:column}
		.form-actions button{width:100%}
		.record-date{font-size:9px}
	}
</style>

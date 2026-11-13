// const CHUNK_BYTES = 16 * 1024;
// const CHUNK_HEADER_BYTES = 8;
// const MAX_TRANSFER_BYTES = 25 * 1024 * 1024;

// export function makePeerConnection() {
// 	return new RTCPeerConnection({
// 		iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
// 	});
// }

// export function waitForIceGathering(peer, timeoutMs = 15000) {
// 	if (peer.iceGatheringState === 'complete') return Promise.resolve();
// 	return new Promise((resolve, reject) => {
// 		const timeout = setTimeout(() => finish(new Error('ICE gathering timed out. Check the network and try again.')), timeoutMs);
// 		function finish(error) {
// 			clearTimeout(timeout);
// 			peer.removeEventListener('icegatheringstatechange', check);
// 			error ? reject(error) : resolve();
// 		}
// 		function check() {
// 			if (peer.iceGatheringState === 'complete') finish();
// 		}
// 		peer.addEventListener('icegatheringstatechange', check);
// 	});
// }

// export function encodeSignal(description) {
// 	const bytes = new TextEncoder().encode(JSON.stringify({ type: description.type, sdp: description.sdp }));
// 	let binary = '';
// 	for (const byte of bytes) binary += String.fromCharCode(byte);
// 	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
// }

// export function decodeSignal(value) {
// 	const encoded = value.trim().replace(/^[^#]*#webrtc-(?:offer|answer)=/, '');
// 	if (!/^[\w-]+$/.test(encoded)) throw new Error('The signaling data is invalid. Paste the complete offer or answer.');
// 	const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
// 	const binary = atob(base64);
// 	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
// 	const data = JSON.parse(new TextDecoder().decode(bytes));
// 	if (!['offer', 'answer'].includes(data.type) || typeof data.sdp !== 'string' || data.sdp.length > 100000) {
// 		throw new Error('The signaling data is incomplete or too large.');
// 	}
// 	return data;
// }

// export async function compressTransfer(bytes) {
// 	if (typeof CompressionStream === 'undefined') return { bytes, compressed: false };
// 	const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
// 	const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
// 	return compressed.length < bytes.length ? { bytes: compressed, compressed: true } : { bytes, compressed: false };
// }

// export async function decompressTransfer(bytes, compressed) {
// 	if (!compressed) return bytes;
// 	if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress the incoming transfer.');
// 	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
// 	return new Uint8Array(await new Response(stream).arrayBuffer());
// }

// export async function sendChunked(channel, bytes, compressed) {
// 	const total = Math.ceil(bytes.length / (CHUNK_BYTES - CHUNK_HEADER_BYTES));
// 	if (!total || bytes.length > MAX_TRANSFER_BYTES) throw new Error('The transfer is empty or exceeds the 25 MB safety limit.');
// 	channel.bufferedAmountLowThreshold = 256 * 1024;
// 	for (let index = 0; index < total; index += 1) {
// 		const start = index * (CHUNK_BYTES - CHUNK_HEADER_BYTES);
// 		const body = bytes.subarray(start, Math.min(start + CHUNK_BYTES - CHUNK_HEADER_BYTES, bytes.length));
// 		const packet = new Uint8Array(CHUNK_HEADER_BYTES + body.length);
// 		const view = new DataView(packet.buffer);
// 		view.setUint32(0, total);
// 		view.setUint32(4, index);
// 		packet.set(body, CHUNK_HEADER_BYTES);
// 		while (channel.bufferedAmount > 1024 * 1024) {
// 			await new Promise((resolve, reject) => {
// 				const timeout = setTimeout(() => { cleanup(); reject(new Error('Transfer stalled while waiting for the connection.')); }, 30000);
// 				const onLow = () => { cleanup(); resolve(); };
// 				const cleanup = () => { clearTimeout(timeout); channel.removeEventListener('bufferedamountlow', onLow); };
// 				channel.addEventListener('bufferedamountlow', onLow, { once: true });
// 				if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) onLow();
// 			});
// 		}
// 		if (channel.readyState !== 'open') throw new Error('The peer connection closed during transfer.');
// 		channel.send(packet);
// 	}
// 	channel.send(JSON.stringify({ type: 'complete', total, compressed }));
// }

// export function createChunkReceiver(onProgress, onComplete, onError) {
// 	let expected = 0;
// 	let expectedTotal = null;
// 	let chunks = [];
// 	let received = 0;
// 	let finished = false;
// 	return async (event) => {
// 		try {
// 			if (typeof event.data === 'string') {
// 				const meta = JSON.parse(event.data);
// 				if (meta.type !== 'complete' || meta.total !== expected || expected === 0) throw new Error('The transfer ended with missing data.');
// 				finished = true;
// 				const output = new Uint8Array(received);
// 				let offset = 0;
// 				for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
// 				await onComplete(output, Boolean(meta.compressed));
// 				return;
// 			}
// 			const packet = new Uint8Array(event.data);
// 			if (packet.byteLength < CHUNK_HEADER_BYTES) throw new Error('A transfer chunk is malformed.');
// 			const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
// 			const total = view.getUint32(0);
// 			const index = view.getUint32(4);
// 			if (!total || total > Math.ceil(MAX_TRANSFER_BYTES / (CHUNK_BYTES - CHUNK_HEADER_BYTES)) || index !== expected || finished || (expectedTotal !== null && expectedTotal !== total)) throw new Error('Transfer chunks arrived out of order or exceeded the size limit.');
// 			expectedTotal = total;
// 			const body = packet.slice(CHUNK_HEADER_BYTES);
// 			received += body.length;
// 			if (received > MAX_TRANSFER_BYTES) throw new Error('The incoming transfer exceeds the 25 MB safety limit.');
// 			chunks.push(body);
// 			expected += 1;
// 			onProgress(expected, total);
// 		} catch (error) {
// 			onError(error);
// 		}
// 	};
// }

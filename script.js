const playlistShell = document.getElementById("playlist-shell");
const playlistToggleButton = document.getElementById("ppanel_hide");
const addSongsButton = document.getElementById("add-songs");
const audioFilesInput = document.getElementById("audio-files");
const songList = document.getElementById("song-list");
const songCount = document.getElementById("song-count");
const playerShell = document.querySelector(".spannel_shell");
const playerTitle = document.getElementById("player-title");
const playerArtist = document.getElementById("player-artist");
const playerArtImage = document.getElementById("player-art-image");
const playerArtPlaceholder = document.getElementById("player-art-placeholder");
const playPauseButton = document.getElementById("play-pause");
const volumeBar = document.getElementById("volume-bar");
const currentTimeLabel = document.getElementById("current-time");
const durationLabel = document.getElementById("duration");
const progressBar = document.getElementById("progress_bar");
const statusMessage = document.getElementById("player-status");
const previousButton = document.getElementById("prev");
const nextButton = document.getElementById("next");
const player = new Audio();
const tracks = [];
const visualizerCanvas = document.getElementById("audio-visualizer");
const visualizerContext = visualizerCanvas.getContext("2d");
const progressVisualizerCanvas = document.getElementById("progress-visualizer");
const progressVisualizerContext = progressVisualizerCanvas.getContext("2d");
let audioContext;
let analyser;
let frequencyData;
let waveformData;
let visualizerFrame;
let lastVisualizerFrameTime = 0;
let activeTrackId = null;
let nextTrackId = 0;

player.volume = Number(volumeBar.value);
playerArtPlaceholder.append(createMusicNoteIcon());

playlistToggleButton.addEventListener("click", () => {
	const isCollapsed = playlistShell.classList.toggle("is-collapsed");
	playlistToggleButton.setAttribute("aria-expanded", String(!isCollapsed));
	playlistToggleButton.setAttribute("aria-label", isCollapsed ? "Show playlist" : "Hide playlist");
	playlistToggleButton.textContent = isCollapsed ? "→" : "←";
});

addSongsButton.addEventListener("click", () => audioFilesInput.click());

audioFilesInput.addEventListener("change", () => {
	addAudioFiles(audioFilesInput.files);
	audioFilesInput.value = "";
});

function isAudioFile(file) {
	return file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|flac|opus|aiff|aif|wma)$/i.test(file.name);
}

function getFileFallback(file) {
	const filename = file.name.replace(/\.[^.]+$/, "").replace(/[._]+/g, " ").trim();
	const separatorIndex = filename.indexOf(" - ");

	if (separatorIndex > 0) {
		return {
			title: filename.slice(separatorIndex + 3).trim(),
			artist: filename.slice(0, separatorIndex).trim()
		};
	}

	return { title: filename || "Untitled track", artist: "Unknown artist" };
}

function addAudioFiles(fileList) {
	const files = Array.from(fileList).filter(isAudioFile);

	if (files.length === 0) {
		setStatus("No supported audio files were found.");
		return;
	}

	const addedTracks = files.map((file) => {
		const fallback = getFileFallback(file);
		const track = {
			id: nextTrackId++,
			file,
			url: URL.createObjectURL(file),
			title: fallback.title,
			artist: fallback.artist,
			coverUrl: "",
			duration: 0,
			waveform: null
		};

		tracks.push(track);
		readEmbeddedTags(track);
		readTrackDuration(track);
		return track;
	});

	generateTrackWaveforms(addedTracks);
	renderPlaylist();
	loadTrack(addedTracks[0], true);
	setStatus(`Added ${addedTracks.length} ${addedTracks.length === 1 ? "track" : "tracks"}.`);
}

async function generateTrackWaveforms(addedTracks) {
	for (const track of addedTracks) {
		await generateTrackWaveform(track);
	}
}

async function generateTrackWaveform(track) {
	if (!ensureAudioGraph() || typeof track.file.arrayBuffer !== "function" || !audioContext.decodeAudioData) {
		return;
	}

	try {
		const audioData = await track.file.arrayBuffer();
		const decodedAudio = await audioContext.decodeAudioData(audioData);
		const peakCount = Math.min(4096, Math.max(1, decodedAudio.length));
		const peakValues = new Float32Array(peakCount);
		const channelData = Array.from({ length: decodedAudio.numberOfChannels }, (_, channelIndex) => decodedAudio.getChannelData(channelIndex));
		let maximumPeak = 0;

		for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
			const firstSample = Math.floor(peakIndex * decodedAudio.length / peakCount);
			const lastSample = Math.max(firstSample + 1, Math.floor((peakIndex + 1) * decodedAudio.length / peakCount));
			const sampleStride = Math.max(1, Math.floor((lastSample - firstSample) / 96));
			let peak = 0;

			for (let sampleIndex = firstSample; sampleIndex < lastSample; sampleIndex += sampleStride) {
				let monoSample = 0;
				for (const channel of channelData) {
					monoSample += channel[sampleIndex] || 0;
				}
				peak = Math.max(peak, Math.abs(monoSample / channelData.length));
			}

			peakValues[peakIndex] = peak;
			maximumPeak = Math.max(maximumPeak, peak);
		}

		track.waveform = Uint8Array.from(peakValues, (peak) => maximumPeak > 0 ? Math.round(peak / maximumPeak * 255) : 0);
		track.duration = track.duration || decodedAudio.duration;
		if (track.id === activeTrackId) {
			renderPlaylist();
			updatePlaybackProgress();
		}
	} catch {
		track.waveform = null;
	}
}

function readEmbeddedTags(track) {
	if (!window.jsmediatags) {
		return;
	}

	window.jsmediatags.read(track.file, {
		onSuccess: (result) => {
			const tags = result.tags || {};
			track.title = tags.title?.trim() || track.title;
			track.artist = tags.artist?.trim() || track.artist;

			if (tags.picture?.data?.length) {
				const picture = tags.picture;
				const mimeType = picture.format?.startsWith("image/") ? picture.format : "image/jpeg";
				track.coverUrl = URL.createObjectURL(new Blob([new Uint8Array(picture.data)], { type: mimeType }));
			}

			renderPlaylist();
			if (track.id === activeTrackId) {
				updatePlayerDetails(track);
			}
		},
		onError: () => {}
	});
}

function readTrackDuration(track) {
	const durationReader = new Audio();
	durationReader.preload = "metadata";
	durationReader.addEventListener("loadedmetadata", () => {
		track.duration = durationReader.duration;
		renderPlaylist();
		if (track.id === activeTrackId) {
			updatePlaybackProgress();
		}
	}, { once: true });
	durationReader.src = track.url;
}

function renderPlaylist() {
	songList.replaceChildren();
	songCount.textContent = `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`;

	if (tracks.length === 0) {
		const emptyItem = document.createElement("li");
		emptyItem.className = "playlist-empty";
		emptyItem.textContent = "Your playlist is empty.";
		songList.append(emptyItem);
		return;
	}

	tracks.forEach((track, index) => {
		const item = document.createElement("li");
		item.className = "song-entry";

		const row = document.createElement("button");
		row.type = "button";
		row.className = "song-row";
		row.setAttribute("aria-current", String(track.id === activeTrackId));
		row.addEventListener("click", () => loadTrack(track, true));

		const cover = document.createElement("span");
		cover.className = "playlist-art";
		cover.setAttribute("aria-hidden", "true");
		if (track.coverUrl) {
			const image = document.createElement("img");
			image.src = track.coverUrl;
			image.alt = "";
			cover.append(image);
		} else {
			cover.append(createMusicNoteIcon());
		}

		const number = document.createElement("span");
		number.className = "track-number";
		number.textContent = String(index + 1).padStart(2, "0");

		const info = document.createElement("span");
		info.className = "track-info";
		const titleViewport = document.createElement("span");
		titleViewport.className = "track-marquee";
		const title = document.createElement("strong");
		title.textContent = track.title;
		titleViewport.append(title);
		const artistViewport = document.createElement("span");
		artistViewport.className = "track-marquee";
		const artist = document.createElement("span");
		artist.textContent = track.artist;
		artistViewport.append(artist);
		info.append(titleViewport, artistViewport);

		const duration = document.createElement("time");
		duration.textContent = formatTime(track.duration);
		row.append(number, cover, info, duration);
		item.append(row);
		songList.append(item);
	});

	requestAnimationFrame(measureTrackMarquees);
}

function measureTrackMarquees() {
	songList.querySelectorAll(".track-marquee").forEach((viewport) => {
		const content = viewport.firstElementChild;
		const overflow = content.scrollWidth - viewport.clientWidth;
		viewport.classList.toggle("is-overflowing", overflow > 1);
		if (overflow > 1) {
			content.style.setProperty("--scroll-distance", `${overflow}px`);
		} else {
			content.style.removeProperty("--scroll-distance");
		}
	});
}

function createMusicNoteIcon() {
	const svgNamespace = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(svgNamespace, "svg");
	const path = document.createElementNS(svgNamespace, "path");

	svg.setAttribute("viewBox", "0 -960 960 960");
	svg.setAttribute("width", "24");
	svg.setAttribute("height", "24");
	svg.setAttribute("fill", "currentColor");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");
	path.setAttribute("d", "M127-167q-47-47-47-113t47-113q47-47 113-47 23 0 42.5 5.5T320-418v-342l480-80v480q0 66-47 113t-113 47q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T720-498v-165l-320 63v320q0 66-47 113t-113 47q-66 0-113-47Z");
	svg.append(path);
	return svg;
}

function loadTrack(track, autoplay) {
	activeTrackId = track.id;
	player.src = track.url;
	player.load();
	updatePlayerDetails(track);
	renderPlaylist();
	updatePlaybackProgress();
	playPauseButton.disabled = false;
	previousButton.disabled = false;
	nextButton.disabled = false;
	if (autoplay) {
		player.play().catch(() => setStatus(`Couldn't play ${track.title}. This audio format may not be supported by your browser.`));
	}
}

function ensureAudioGraph() {
	if (!audioContext) {
		const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextConstructor) {
			return false;
		}

		audioContext = new AudioContextConstructor();
		analyser = audioContext.createAnalyser();
		analyser.fftSize = 2048;
		analyser.smoothingTimeConstant = 0.82;
		frequencyData = new Uint8Array(analyser.frequencyBinCount);
		waveformData = new Uint8Array(analyser.fftSize);
		const source = audioContext.createMediaElementSource(player);
		source.connect(analyser);
		analyser.connect(audioContext.destination);
	}
	return true;
}


function setupAudioVisualizer() {
	if (!ensureAudioGraph()) {
		return;
	}
	if (audioContext.state === "suspended") {
		audioContext.resume();
	}
	if (!visualizerFrame) {
		lastVisualizerFrameTime = 0;
		visualizerFrame = requestAnimationFrame(drawAudioVisualizer);
	}
}

function resizeAudioVisualizer() {
	const pixelRatio = Math.min(window.devicePixelRatio || 1, 1);
	visualizerCanvas.width = Math.round(window.innerWidth * pixelRatio);
	visualizerCanvas.height = Math.round(window.innerHeight * pixelRatio);
	visualizerContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
	const progressBounds = progressVisualizerCanvas.getBoundingClientRect();
	progressVisualizerCanvas.width = Math.round(progressBounds.width * pixelRatio);
	progressVisualizerCanvas.height = Math.round(progressBounds.height * pixelRatio);
	progressVisualizerContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
	drawProgressVisualizer(getVisualizerColor());
	if (player.paused) {
		drawAudioVisualizer();
	}
}

function drawAudioVisualizer(timestamp = 0) {
	visualizerFrame = null;
	if (!player.paused && timestamp - lastVisualizerFrameTime < 1000 / 30) {
		visualizerFrame = requestAnimationFrame(drawAudioVisualizer);
		return;
	}
	lastVisualizerFrameTime = timestamp;
	const width = window.innerWidth;
	const height = window.innerHeight;
	const color = getVisualizerColor();
	const playlistBounds = playlistShell.getBoundingClientRect();
	const playerBounds = playerShell.getBoundingClientRect();
	const stageBottom = Math.max(0, Math.min(height, playerBounds.top));
	const lineCenterY = stageBottom * 0.5;
	const barBaseline = stageBottom - 8;
	const barCount = Math.max(32, Math.floor(width / 13));
	const barWidth = width / barCount * 0.56;

	visualizerContext.clearRect(0, 0, width, height);
	visualizerContext.save();
	visualizerContext.beginPath();
	visualizerContext.rect(0, 0, width, height);
	visualizerContext.rect(playlistBounds.left, playlistBounds.top, playlistBounds.width, playlistBounds.height);
	visualizerContext.rect(playerBounds.left, playerBounds.top, playerBounds.width, playerBounds.height);
	visualizerContext.clip("evenodd");
	if (analyser && !player.paused) {
		analyser.getByteFrequencyData(frequencyData);
		analyser.getByteTimeDomainData(waveformData);
	} else if (frequencyData) {
		frequencyData.fill(0);
		waveformData.fill(128);
	}
	visualizerContext.globalAlpha = 0.7;
	visualizerContext.lineWidth = 2;
	visualizerContext.beginPath();
	for (let index = 0; index < width; index += 2) {
		const dataIndex = Math.floor(index / width * (waveformData?.length || 1));
		const sample = waveformData ? (waveformData[dataIndex] - 128) / 128 : 0;
		const y = lineCenterY + sample * height * 0.13;
		if (index === 0) {
			visualizerContext.moveTo(index, y);
		} else {
			visualizerContext.lineTo(index, y);
		}
	}
	visualizerContext.strokeStyle = color;
	visualizerContext.stroke();

	visualizerContext.fillStyle = color;
	for (let index = 0; index < barCount; index += 1) {
		const bin = Math.floor(index / barCount * (frequencyData?.length || 0));
		const amplitude = frequencyData ? frequencyData[bin] / 255 : 0;
		const barHeight = 3 + amplitude * stageBottom * 0.82;
		visualizerContext.globalAlpha = 0.2 + amplitude * 0.8;
		visualizerContext.fillRect(index * width / barCount, barBaseline - barHeight, barWidth, barHeight);
	}
	visualizerContext.globalAlpha = 1;
	visualizerContext.restore();
	if (!player.paused) {
		visualizerFrame = requestAnimationFrame(drawAudioVisualizer);
	}
}

function drawProgressVisualizer(color) {
	const width = progressBar.clientWidth;
	const height = progressBar.clientHeight;
	const barCount = Math.max(1, Math.floor(width / 2.5));
	const barStep = width / barCount;
	const barWidth = Math.max(1, barStep * 0.58);
	const track = getActiveTrack();
	const waveform = track?.waveform;
	const duration = Number.isFinite(player.duration) ? player.duration : track?.duration || 0;
	const playedRatio = duration > 0 ? player.currentTime / duration : 0;

	progressVisualizerContext.clearRect(0, 0, width, height);
	progressVisualizerContext.fillStyle = color;
	for (let index = 0; index < barCount; index += 1) {
		let amplitude = 0;
		if (waveform) {
			const firstPeak = Math.floor(index / barCount * waveform.length);
			const lastPeak = Math.max(firstPeak + 1, Math.floor((index + 1) / barCount * waveform.length));
			for (let peakIndex = firstPeak; peakIndex < lastPeak; peakIndex += 1) {
				amplitude = Math.max(amplitude, waveform[peakIndex] / 255);
			}
		} else if (frequencyData) {
			const bin = Math.floor(index / barCount * frequencyData.length);
			amplitude = frequencyData[bin] / 255;
		}
		const barHeight = 1 + amplitude * Math.max(0, height - 4);
		const isPlayed = index / barCount <= playedRatio;
		progressVisualizerContext.globalAlpha = waveform ? (isPlayed ? 0.45 : 0.22) + amplitude * 0.5 : 0.25 + amplitude * 0.75;
		progressVisualizerContext.fillRect(index * barStep, height - barHeight, barWidth, barHeight);
	}
	progressVisualizerContext.globalAlpha = 1;
}

function getVisualizerColor() {
	return getComputedStyle(document.documentElement).getPropertyValue("--visualizer-color").trim() || "#ff5e00";
}

function updatePlayerDetails(track) {
	playerTitle.textContent = track.title;
	playerArtist.textContent = track.artist;
	playerArtImage.hidden = !track.coverUrl;
	playerArtPlaceholder.hidden = Boolean(track.coverUrl);
	if (track.coverUrl) {
		playerArtImage.src = track.coverUrl;
	} else {
		playerArtImage.removeAttribute("src");
	}
}

function getActiveTrack() {
	return tracks.find((track) => track.id === activeTrackId);
}

function formatTime(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) {
		return "0:00";
	}
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
	return `${minutes}:${remainingSeconds}`;
}

function updatePlaybackProgress() {
	const track = getActiveTrack();
	const duration = Number.isFinite(player.duration) ? player.duration : track?.duration || 0;
	const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
	const progress = duration > 0 ? currentTime / duration * 100 : 0;

	progressBar.style.setProperty("--progress", `${progress}%`);
	progressBar.setAttribute("aria-valuenow", String(Math.round(progress)));
	progressBar.setAttribute("aria-valuetext", `${formatTime(currentTime)} of ${formatTime(duration)}`);
	progressBar.setAttribute("aria-disabled", String(!track || duration <= 0));
	currentTimeLabel.textContent = formatTime(currentTime);
	durationLabel.textContent = formatTime(duration);
	drawProgressVisualizer(getVisualizerColor());
}

function updatePlayPauseButton() {
	const isPlaying = !player.paused;
	playPauseButton.replaceChildren(createTransportIcon(isPlaying ? "pause" : "play"));
	playPauseButton.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
}

function createTransportIcon(iconName) {
	const iconPaths = {
		play: "M8 5v14l11-7z",
		pause: "M6 5h4v14H6zm8 0h4v14h-4z"
	};
	const svgNamespace = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(svgNamespace, "svg");
	const path = document.createElementNS(svgNamespace, "path");

	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("width", "20");
	svg.setAttribute("height", "20");
	svg.setAttribute("fill", "currentColor");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");
	path.setAttribute("d", iconPaths[iconName]);
	svg.append(path);
	return svg;
}

function changeTrack(direction) {
	if (tracks.length === 0) {
		return;
	}
	const currentIndex = tracks.findIndex((track) => track.id === activeTrackId);
	const nextIndex = (currentIndex + direction + tracks.length) % tracks.length;
	loadTrack(tracks[nextIndex], true);
}

function setStatus(message) {
	statusMessage.textContent = message;
}

playPauseButton.addEventListener("click", () => {
	if (player.paused) {
		setupAudioVisualizer();
		player.play().catch(() => setStatus("This audio format may not be supported by your browser."));
	} else {
		player.pause();
	}
});

previousButton.addEventListener("click", () => changeTrack(-1));
nextButton.addEventListener("click", () => changeTrack(1));
player.addEventListener("timeupdate", updatePlaybackProgress);
player.addEventListener("loadedmetadata", updatePlaybackProgress);
player.addEventListener("durationchange", updatePlaybackProgress);
player.addEventListener("play", () => {
	setupAudioVisualizer();
	updatePlayPauseButton();
});
player.addEventListener("pause", () => {
	updatePlayPauseButton();
	if (visualizerFrame) {
		cancelAnimationFrame(visualizerFrame);
		visualizerFrame = null;
	}
	drawAudioVisualizer();
	drawProgressVisualizer(getVisualizerColor());
});
player.addEventListener("ended", () => changeTrack(1));
player.addEventListener("error", () => {
	if (getActiveTrack()) {
		setStatus("This audio file could not be played by your browser.");
	}
});

volumeBar.addEventListener("input", () => {
	player.volume = Number(volumeBar.value);
});

function seekFromPointer(clientX) {
	const duration = Number.isFinite(player.duration) ? player.duration : getActiveTrack()?.duration || 0;
	const bounds = progressBar.getBoundingClientRect();
	if (duration <= 0 || bounds.width <= 0) {
		return;
	}
	const position = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
	player.currentTime = position * duration;
}

progressBar.addEventListener("pointerdown", (event) => {
	if (progressBar.getAttribute("aria-disabled") === "true") {
		return;
	}
	event.preventDefault();
	progressBar.setPointerCapture(event.pointerId);
	seekFromPointer(event.clientX);
});

progressBar.addEventListener("pointermove", (event) => {
	if (progressBar.hasPointerCapture(event.pointerId)) {
		seekFromPointer(event.clientX);
	}
});

progressBar.addEventListener("pointerup", (event) => {
	if (progressBar.hasPointerCapture(event.pointerId)) {
		progressBar.releasePointerCapture(event.pointerId);
	}
});

progressBar.addEventListener("keydown", (event) => {
	const duration = Number.isFinite(player.duration) ? player.duration : getActiveTrack()?.duration || 0;
	if (duration <= 0) {
		return;
	}
	if (event.key === "ArrowLeft") {
		player.currentTime = Math.max(0, player.currentTime - 5);
	} else if (event.key === "ArrowRight") {
		player.currentTime = Math.min(duration, player.currentTime + 5);
	} else if (event.key === "Home") {
		player.currentTime = 0;
	} else if (event.key === "End") {
		player.currentTime = duration;
	} else {
		return;
	}
	event.preventDefault();
});

playerShell.addEventListener("dragenter", (event) => {
	event.preventDefault();
	playerShell.classList.add("is-drop-target");
});
playerShell.addEventListener("dragover", (event) => {
	event.preventDefault();
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = "copy";
	}
});
playerShell.addEventListener("dragleave", (event) => {
	if (!playerShell.contains(event.relatedTarget)) {
		playerShell.classList.remove("is-drop-target");
	}
});
playerShell.addEventListener("drop", (event) => {
	event.preventDefault();
	playerShell.classList.remove("is-drop-target");
	addAudioFiles(event.dataTransfer.files);
});

renderPlaylist();
updatePlayPauseButton();
window.addEventListener("resize", measureTrackMarquees);
resizeAudioVisualizer();
window.addEventListener("resize", resizeAudioVisualizer);

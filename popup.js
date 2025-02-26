'use strict'

let tid = 0
const frameMap = new Map()
const elementsList = document.getElementById('elements-list')
const allElements = document.getElementById('all-elements')
const indivElements = document.getElementById('individual-elements')
const elementsTpl = document.getElementById('elements-tpl')
let hostname = null
let tld = null
const saveSub = document.getElementById('save-sub')
const saveTld = document.getElementById('save-tld')

function applySettings (fid, elid, newSettings) {
	return Promise.all([browser.tabs.executeScript(tid, { frameId: fid, code: `(function () {
		const el = document.querySelector('[data-x-soundfixer-id="${elid}"]')
		if (!el.xSoundFixerContext) {
			el.xSoundFixerContext = new AudioContext()
			el.xSoundFixerGain = el.xSoundFixerContext.createGain()
			el.xSoundFixerPan = el.xSoundFixerContext.createStereoPanner()
			el.xSoundFixerSplit = el.xSoundFixerContext.createChannelSplitter(2)
			el.xSoundFixerMerge = el.xSoundFixerContext.createChannelMerger(2)
			el.xSoundFixerSource = el.xSoundFixerContext.createMediaElementSource(el)
			el.xSoundFixerSource.connect(el.xSoundFixerGain)
			el.xSoundFixerGain.connect(el.xSoundFixerPan)
			el.xSoundFixerPan.connect(el.xSoundFixerContext.destination)
			el.xSoundFixerOriginalChannels = el.xSoundFixerContext.destination.channelCount
		}
		const newSettings = ${JSON.stringify(newSettings)}
		if ('gain' in newSettings) {
			el.xSoundFixerGain.gain.value = newSettings.gain
		}
		if ('pan' in newSettings) {
			el.xSoundFixerPan.pan.value = newSettings.pan
		}
		if ('mono' in newSettings) {
			el.xSoundFixerContext.destination.channelCount = newSettings.mono ? 1 : el.xSoundFixerOriginalChannels
		}
		if ('flip' in newSettings) {
			el.xSoundFixerFlipped = newSettings.flip
			el.xSoundFixerMerge.disconnect()
			el.xSoundFixerPan.disconnect()
			if (el.xSoundFixerFlipped) {
				el.xSoundFixerPan.connect(el.xSoundFixerSplit)
				el.xSoundFixerSplit.connect(el.xSoundFixerMerge, 0, 1)
				el.xSoundFixerSplit.connect(el.xSoundFixerMerge, 1, 0)
				el.xSoundFixerMerge.connect(el.xSoundFixerContext.destination)
			} else {
				el.xSoundFixerPan.connect(el.xSoundFixerContext.destination)
			}
		}
		el.xSoundFixerSettings = {
			gain: el.xSoundFixerGain.gain.value,
			pan: el.xSoundFixerPan.pan.value,
			mono: el.xSoundFixerContext.destination.channelCount == 1,
			flip: el.xSoundFixerFlipped,
		}
	})()` }), saveSettings(newSettings)])
}

function saveSettings() {
  const newSettings = {
    gain: (document.querySelector('.element-gain').value || 1),
    flip: document.querySelector('.element-flip').checked,
    mono: document.querySelector('.element-mono').checked,
    pan: document.querySelector('.element-pan').value || 0
  }
  const toSave = {}
  if (saveTld.checked) {
    toSave[tld] = newSettings
  } else if (saveSub.checked) {
    toSave[hostname] = newSettings
  } else {
    return null
  }
  console.log("saving...", toSave)
  return browser.storage.local.set(toSave)
}

function loadSettings() {
  return browser.storage.local.get([tld, hostname]).then(result => result[tld] || result[hostname])
}

function tldToggle() {
  console.log("toggled tld: " + saveTld.checked)
  if (saveTld.checked) {
    saveSub.checked = false
    saveSub.disabled = true
    saveSub.dispatchEvent(new Event("change"))
    saveSettings()
  } else {
    saveSub.disabled = false
    browser.storage.local.remove(tld)
  }
}

function subToggle() {
  console.log("toggled subdomain: " + saveSub.checked)
  if (saveSub.checked) {
    saveSettings()
  } else {
    browser.storage.local.remove(hostname)
  }
}

browser.tabs.query({ currentWindow: true, active: true }).then(tabs => {
	tid = tabs[0].id
  const prom1 = browser.tabs.executeScript(tid, { code: `window.location.hostname` }).then(hn => {
    hostname = hn[0]
    tld = "*." + hostname.split(".").slice(-2).join(".")
  })
	const prom2 = browser.webNavigation.getAllFrames({ tabId: tid }).then(frames =>
		Promise.all(frames.map(frame => {
			const fid = frame.frameId
			return browser.tabs.executeScript(tid, { frameId: fid, code: `(function () {
				const result = new Map()
				for (const el of document.querySelectorAll('video, audio')) {
					if (!el.hasAttribute('data-x-soundfixer-id')) {
						el.setAttribute('data-x-soundfixer-id',
							Math.random().toString(36).substr(2, 10))
					}
					result.set(el.getAttribute('data-x-soundfixer-id'), {
						type: el.tagName.toLowerCase(),
						isPlaying: (el.currentTime > 0 && !el.paused && !el.ended && el.readyState > 2),
						settings: el.xSoundFixerSettings
					})
				}
				return result
			})()` }).then(result => frameMap.set(fid, result[0]))
			.catch(err => console.error(`tab ${tid} frame ${fid}`, err))
		}))
  )
  return Promise.all([prom1, prom2])
}).then(_ => {
  // add checkboxes to save dropdown
  saveSub.addEventListener('change', subToggle)
  saveTld.addEventListener('change', tldToggle)
  // update checkboxes to correct domain names
  document.querySelector('[for="save-sub"]').innerHTML = `Save settings for ${hostname}`
  document.querySelector('[for="save-tld"]').innerHTML = `Save settings for ${tld}`
  // load saved settings
  return loadSettings()
}).then(loadedSettings => {
  console.log(loadedSettings)
	elementsList.textContent = ''
	let elCount = 0
	for (const [fid, els] of frameMap) {
		for (const [elid, el] of els) {
			const settings = el.settings || loadedSettings || {}
			const node = document.createElement('li')
			node.appendChild(document.importNode(elementsTpl.content, true))
			node.dataset.fid = fid
			node.dataset.elid = elid
			node.querySelector('.element-label').textContent = `
				${el.type.charAt(0).toUpperCase() + el.type.slice(1)}
				${elCount + 1}
				${fid ? `in frame ${fid}` : ''}
				${el.isPlaying ? '' : '(not playing)'}
			`
			if (!el.isPlaying)
				node.querySelector('.element-label').classList.add('element-not-playing')
			const gain = node.querySelector('.element-gain')
			const gainNumberInput = node.querySelector('.element-gain-num')
			gain.value = settings.gain || 1
			gain.parentElement.querySelector('.element-gain-num').value = '' + gain.value
			gain.addEventListener('input', function () {
				// We used a function expression thus gain === this
				applySettings(fid, elid, { gain: this.value })
				this.parentElement.querySelector('.element-gain-num').value = '' + this.value
			})
			gainNumberInput.addEventListener('input', function () {
				if (+this.value > +this.getAttribute('max'))
					this.value = this.getAttribute('max')
				if (+this.value < +this.getAttribute('min'))
					this.value = this.getAttribute('min')
				
				applySettings(fid, elid, { gain: this.value })
				this.parentElement.querySelector('.element-gain').value = '' + this.value
			})
			const pan = node.querySelector('.element-pan')
			const panNumberInput = node.querySelector('.element-pan-num')
			pan.value = settings.pan || 0
			pan.parentElement.querySelector('.element-pan-num').value = '' + pan.value
			pan.addEventListener('input', function () {
				applySettings(fid, elid, { pan: this.value })
				this.parentElement.querySelector('.element-pan-num').value = '' + this.value
			})
			panNumberInput.addEventListener('input', function () {
				if (+this.value > +this.getAttribute('max'))
					this.value = this.getAttribute('max')
				if (+this.value < +this.getAttribute('min'))
					this.value = this.getAttribute('min')
				
				applySettings(fid, elid, { pan: this.value })
				this.parentElement.querySelector('.element-pan').value = '' + this.value
			})
			const mono = node.querySelector('.element-mono')
			mono.checked = settings.mono || false
			mono.addEventListener('change', _ => {
				applySettings(fid, elid, { mono: mono.checked })
			})
			const flip = node.querySelector('.element-flip')
			flip.checked = settings.flip || false
			flip.addEventListener('change', _ => {
				applySettings(fid, elid, { flip: flip.checked })
			})
			node.querySelector('.element-reset').onclick = function () {
				gain.value = 1
				gain.parentElement.querySelector('.element-gain-num').value = '' + gain.value
				pan.value = 0
				pan.parentElement.querySelector('.element-pan-num').value = '' + pan.value
				mono.checked = false
				flip.checked = false
				applySettings(fid, elid, { gain: 1, pan: 0, mono: false, flip: false })
			}
			elementsList.appendChild(node)
			elCount += 1
		}
	}
	if (elCount == 0) {
			allElements.innerHTML = 'No audio/video found in the current tab. Note that some websites do not work because of cross-domain security restrictions.'
			indivElements.remove()
	} else {
			const node = document.createElement('div')
			node.appendChild(document.importNode(elementsTpl.content, true))
			node.querySelector('.element-label').textContent = `All media on the page`
			const gain = node.querySelector('.element-gain')
			const gainNumberInput = node.querySelector('.element-gain-num')
			gain.value = 1
			gainNumberInput.value = '' + gain.value
			function applyGain (value) {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { gain: value })
						const egain = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-gain`)
						egain.value = value
						egain.parentElement.querySelector('.element-gain-num').value = '' + value
					}
				}
				gain.value = value
				gainNumberInput.value = '' + value
			}
			gain.addEventListener('input', _ => applyGain(gain.value))
      gain.addEventListener('change', saveSettings)
			gainNumberInput.addEventListener('input', function () {
				if (+this.value > +this.getAttribute('max'))
					this.value = this.getAttribute('max')
				if (+this.value < +this.getAttribute('min'))
					this.value = this.getAttribute('min')
				applyGain(+this.value)
			})
			const pan = node.querySelector('.element-pan')
			const panNumberInput = node.querySelector('.element-pan-num')
			pan.value = 0
			panNumberInput.value = '' + pan.value
			function applyPan (value) {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { pan: value })
						const epan = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-pan`)
						epan.value = value
						epan.parentElement.querySelector('.element-pan-num').value = '' + value
					}
				}
				pan.value = value
				panNumberInput.value = '' + value
			}
			pan.addEventListener('input', _ => applyPan(pan.value))
      pan.addEventListener('change', saveSettings)
			panNumberInput.addEventListener('input', function () {
				if (+this.value > +this.getAttribute('max'))
					this.value = this.getAttribute('max')
				if (+this.value < +this.getAttribute('min'))
					this.value = this.getAttribute('min')
				applyPan(+this.value)
			})
			const mono = node.querySelector('.element-mono')
			mono.checked = false
			mono.addEventListener('change', _ => {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { mono: mono.checked })
						const emono = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-mono`)
						emono.checked = mono.checked
					}
				}
			})
      mono.addEventListener('change', saveSettings)
			const flip = node.querySelector('.element-flip')
			flip.checked = false
			flip.addEventListener('change', _ => {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { flip: flip.checked })
						const eflip = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-flip`)
						eflip.checked = flip.checked
					}
				}
			})
      flip.addEventListener('change', saveSettings);
			node.querySelector('.element-reset').onclick = function () {
				gain.value = 1
				gain.parentElement.querySelector('.element-gain-num').value = '' + gain.value
				pan.value = 0
				pan.parentElement.querySelector('.element-pan-num').value = '' + pan.value
				mono.checked = false
				flip.checked = false
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						const egain = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-gain`)
						egain.value = 1
						egain.parentElement.querySelector('.element-gain-num').value = '' + egain.value
						const epan = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-pan`)
						epan.value = 0
						epan.parentElement.querySelector('.element-pan-num').value = '' + epan.value
						document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-mono`).checked = false
						document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-flip`).checked = false
						applySettings(fid, elid, { gain: 1, pan: 0, mono: false, flip: false })
					}
				}
			}
			allElements.appendChild(node)
	}
})

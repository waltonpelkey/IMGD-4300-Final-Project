import { default as seagulls } from '/gulls.js'
import { default as Video } from './video.js'

const shaderVersion = '2026-04-27-neighbor-colors'

const sg      = await seagulls.init(),
      frag    = await seagulls.import( `./frag.wgsl?v=${shaderVersion}` ),
      videoFrag = await seagulls.import( `./video_frag.wgsl?v=${shaderVersion}` ),
      compute = await seagulls.import( `./compute.wgsl?v=${shaderVersion}` ),
      render  = seagulls.constants.vertex + frag,
      videoRender = seagulls.constants.vertex + videoFrag,
      size    = (window.innerWidth * window.innerHeight),
      state   = new Float32Array( size ),
      neighborCounts = new Float32Array( size )

for( let i = 0; i < size; i++ ) {
  state[ i ] = Math.round( Math.random() )
}

const statebuffer1 = sg.buffer( state )
const statebuffer2 = sg.buffer( state )
const neighborCountBuffer = sg.buffer( neighborCounts )
const res = sg.uniform([ window.innerWidth, window.innerHeight ])
const screenCaptureButton = document.getElementById( 'screen_capture' )
const reseedButton = document.getElementById( 'reseed' )
const seedThresholdSlider = document.getElementById( 'seed_threshold' )
const seedThresholdValue = document.getElementById( 'seed_threshold_value' )
const neighborReachSlider = document.getElementById( 'neighbor_reach' )
const neighborReachValue = document.getElementById( 'neighbor_reach_value' )
const presetValuesSelect = document.getElementById( 'preset_values' )
const randomizeAgainButton = document.getElementById( 'randomize_again' )
const neighborControls = document.getElementById( 'neighbor_controls' )
const neighborRuleInputs = document.getElementById( 'neighbor_rule_inputs' )
const video_sampler = sg.sampler()
const previewThreshold = sg.uniform([ 0.5, 0, 0, 0 ])
const neighborConfig = sg.uniform([ 1, 0, 0, 0 ])
const captureCanvas = document.createElement( 'canvas' )
const captureContext = captureCanvas.getContext( '2d', { willReadFrequently:true } )
const ruleMapping = {
  die: 0,
  live: 1,
  live_and_birth: 2
}
const ruleValueToOption = [ 'die', 'live', 'live_and_birth' ]
let simulationStarted = false
let capturedFrame = null
let ruleValues = createPresetRuleValues( 'day_and_night', getNeighborReach() )
let ruleBuffer = sg.buffer( ruleValues )

await Video.init()
const cameraTexture = Video.element !== null ? sg.video( Video.element ) : null

window.Video = Video
window.cameraTexture = cameraTexture
window.capturedFrame = capturedFrame

function getSeedThreshold() {
  if( seedThresholdSlider === null ) return 0.5

  return Number.parseFloat( seedThresholdSlider.value )
}

function getNeighborReach() {
  if( neighborReachSlider === null ) return 1

  return Number.parseInt( neighborReachSlider.value, 10 )
}

function getMaxNeighborCount( neighborReach ) {
  return ( ( ( neighborReach * 2 ) + 1 ) * ( ( neighborReach * 2 ) + 1 ) ) - 1
}

function getRuleSlotCount( neighborReach ) {
  return getMaxNeighborCount( neighborReach ) + 1
}

function createPresetRuleValues( preset, neighborReach ) {
  const slotCount = getRuleSlotCount( neighborReach )
  const values = new Uint32Array( slotCount )
  values.fill( 1 )

  switch( preset ) {
    case 'game_of_life':
      values.set([ 0, 0, 1, 2, 0, 0, 0, 0, 0 ])
      break
    case 'day_and_night':
      values.set([ 0, 0, 0, 2, 1, 0, 2, 2, 2 ])
      break
    case 'randomized':
      for( let i = 0; i < values.length; i++ ) {
        values[ i ] = Math.floor( Math.random() * 3 )
      }
      break
    default:
      break
  }

  return values
}

function resizeRuleValues( previousValues, neighborReach ) {
  const nextValues = new Uint32Array( getRuleSlotCount( neighborReach ) )
  nextValues.set( previousValues.subarray( 0, Math.min( previousValues.length, nextValues.length ) ) )

  return nextValues
}

function replaceRuleBuffer( nextRuleValues ) {
  ruleValues = nextRuleValues
  ruleBuffer = sg.buffer( ruleValues )
}

function updateNeighborConfig() {
  const neighborReach = getNeighborReach()
  neighborConfig.value = [ neighborReach, getRuleSlotCount( neighborReach ), 0, 0 ]
}

function updateSeedThresholdLabel() {
  if( seedThresholdSlider === null || seedThresholdValue === null ) return

  const threshold = getSeedThreshold()
  seedThresholdValue.textContent = threshold.toFixed( 2 )
  previewThreshold.value = [ threshold, 0, 0, 0 ]
}

function updateNeighborReachLabel() {
  if( neighborReachSlider === null || neighborReachValue === null ) return

  neighborReachValue.textContent = neighborReachSlider.value
}

function writeRuleValues() {
  sg.device.queue.writeBuffer( ruleBuffer.buffer, 0, ruleValues )
}

function setRule( index, value ) {
  ruleValues[ index ] = ruleMapping[ value ]
  writeRuleValues()
}

function createRuleSelect( index, value ) {
  const label = document.createElement( 'label' )
  const labelText = document.createElement( 'span' )
  const select = document.createElement( 'select' )
  const neighborLabel = index === 1 ? '1 neighbor' : `${index} neighbors`

  label.htmlFor = `neighbors_${index}`
  labelText.textContent = neighborLabel

  select.id = `neighbors_${index}`
  select.disabled = presetValuesSelect !== null && presetValuesSelect.value !== 'custom'

  for( const optionValue of ruleValueToOption ) {
    const option = document.createElement( 'option' )
    option.value = optionValue
    option.textContent = optionValue.replaceAll( '_', ' ' )
    select.append( option )
  }

  select.value = ruleValueToOption[ value ]
  select.addEventListener( 'change', () => {
    setRule( index, select.value )
  })

  label.append( labelText, select )

  return label
}

function renderNeighborInputs() {
  if( neighborRuleInputs === null ) return

  neighborRuleInputs.replaceChildren()

  if( presetValuesSelect === null || presetValuesSelect.value !== 'custom' ) return

  for( let i = 0; i < ruleValues.length; i++ ) {
    neighborRuleInputs.append( createRuleSelect( i, ruleValues[ i ] ) )
  }
}

function updateNeighborControlsVisibility() {
  if( neighborControls === null || presetValuesSelect === null ) return

  const showCustomControls = presetValuesSelect.value === 'custom'
  neighborControls.hidden = !showCustomControls

  for( const select of neighborControls.querySelectorAll( 'select' ) ) {
    select.disabled = !showCustomControls
  }
}

function updateRandomizeAgainVisibility() {
  if( randomizeAgainButton === null || presetValuesSelect === null ) return

  randomizeAgainButton.hidden = presetValuesSelect.value !== 'randomized'
}

function applyRulePreset( preset ) {
  if( preset === 'custom' ) return

  replaceRuleBuffer( createPresetRuleValues( preset, getNeighborReach() ) )
  updateNeighborConfig()
  writeRuleValues()
  renderNeighborInputs()
}

function updateRulesForNeighborReach() {
  const neighborReach = getNeighborReach()
  let nextRuleValues

  if( presetValuesSelect !== null && presetValuesSelect.value === 'custom' ) {
    nextRuleValues = resizeRuleValues( ruleValues, neighborReach )
  }else{
    const preset = presetValuesSelect !== null ? presetValuesSelect.value : 'day_and_night'
    nextRuleValues = createPresetRuleValues( preset, neighborReach )
  }

  replaceRuleBuffer( nextRuleValues )
  updateNeighborConfig()
  writeRuleValues()
  renderNeighborInputs()
  updateNeighborControlsVisibility()
  rebuildComputePass()
}

const videoPass = cameraTexture !== null
  ? await sg.render({
      shader: videoRender,
      data: [ res, video_sampler, previewThreshold, cameraTexture ]
    })
  : null

const renderPass = await sg.render({
  shader: render,
  data: [
    res,
    sg.pingpong( statebuffer1, statebuffer2 ),
    neighborCountBuffer,
    neighborConfig
  ]
})

let computePass = null

function rebuildComputePass() {
  computePass = sg.compute({
    shader: compute,
    data: [ res, sg.pingpong( statebuffer1, statebuffer2 ), neighborConfig, ruleBuffer, neighborCountBuffer ],
    dispatchCount:  [ Math.round( seagulls.width / 8 ), Math.round( seagulls.height / 8 ), 1 ],
  })
}

function writeState() {
  sg.device.queue.writeBuffer( statebuffer1.buffer, 0, state )
  sg.device.queue.writeBuffer( statebuffer2.buffer, 0, state )
}

function startSimulation() {
  if( simulationStarted ) return

  simulationStarted = true
}

function reseedSimulation() {
  simulationStarted = false
  capturedFrame = null
  window.capturedFrame = capturedFrame

  if( screenCaptureButton !== null ) {
    screenCaptureButton.disabled = false
  }
}

function seedStateFromPixels( pixels ) {
  const threshold = getSeedThreshold()

  for( let i = 0; i < size; i++ ) {
    const base = i * 4
    const red = pixels[ base + 0 ] / 255
    const green = pixels[ base + 1 ] / 255
    const blue = pixels[ base + 2 ] / 255
    const lightness = ( Math.max( red, green, blue ) + Math.min( red, green, blue ) ) * 0.5

    state[ i ] = lightness >= threshold ? 1 : 0
  }

  writeState()
}

async function captureVideoFrame() {
  if( captureContext === null ) {
    throw new Error( 'Could not create video capture context.' )
  }

  if( Video.element === null ) {
    throw new Error( 'Video is not available.' )
  }

  if( Video.element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ) {
    await new Promise( resolve => {
      Video.element.onloadeddata = resolve
    })
  }

  if( 'requestVideoFrameCallback' in Video.element ) {
    await new Promise( resolve => {
      Video.element.requestVideoFrameCallback( () => resolve() )
    })
  }else{
    await new Promise( resolve => window.requestAnimationFrame( () => resolve() ) )
  }

  captureCanvas.width = Video.element.videoWidth
  captureCanvas.height = Video.element.videoHeight
  captureContext.drawImage( Video.element, 0, 0, captureCanvas.width, captureCanvas.height )

  const fullImageData = captureContext.getImageData( 0, 0, captureCanvas.width, captureCanvas.height )

  captureCanvas.width = sg.width
  captureCanvas.height = sg.height
  captureContext.drawImage( Video.element, 0, 0, captureCanvas.width, captureCanvas.height )

  const simImageData = captureContext.getImageData( 0, 0, captureCanvas.width, captureCanvas.height )

  return {
    full:{
      width:fullImageData.width,
      height:fullImageData.height,
      pixels:new Uint8ClampedArray( fullImageData.data )
    },
    simPixels:new Uint8ClampedArray( simImageData.data )
  }
}

async function onScreenCapture() {
  if( simulationStarted ) return

  if( screenCaptureButton !== null ) {
    screenCaptureButton.disabled = true
  }

  try {
    const videoFrame = await captureVideoFrame()
    capturedFrame = videoFrame.full
    window.capturedFrame = capturedFrame

    seedStateFromPixels( videoFrame.simPixels )
    startSimulation()
  } catch( error ) {
    console.warn( 'video frame capture failed', error )
  } finally {
    if( screenCaptureButton !== null && !simulationStarted ) {
      screenCaptureButton.disabled = false
    }
  }
}

updateSeedThresholdLabel()
updateNeighborReachLabel()
updateNeighborConfig()
renderNeighborInputs()
updateNeighborControlsVisibility()
updateRandomizeAgainVisibility()
writeRuleValues()
rebuildComputePass()

if( screenCaptureButton !== null ) {
  screenCaptureButton.addEventListener( 'click', onScreenCapture )
}

if( reseedButton !== null ) {
  reseedButton.addEventListener( 'click', reseedSimulation )
}

if( randomizeAgainButton !== null ) {
  randomizeAgainButton.addEventListener( 'click', () => {
    if( presetValuesSelect === null || presetValuesSelect.value !== 'randomized' ) return

    applyRulePreset( 'randomized' )
    rebuildComputePass()
  })
}

if( seedThresholdSlider !== null ) {
  seedThresholdSlider.addEventListener( 'input', updateSeedThresholdLabel )
}

if( neighborReachSlider !== null ) {
  neighborReachSlider.addEventListener( 'input', () => {
    updateNeighborReachLabel()
    updateRulesForNeighborReach()
  })
}

if( presetValuesSelect !== null ) {
  presetValuesSelect.addEventListener( 'change', () => {
    updateNeighborControlsVisibility()
    updateRandomizeAgainVisibility()

    if( presetValuesSelect.value !== 'custom' ) {
      applyRulePreset( presetValuesSelect.value )
      rebuildComputePass()
    }else{
      renderNeighborInputs()
      rebuildComputePass()
    }
  })
}

async function frame() {
  if( simulationStarted && computePass !== null ) {
    await sg.once( computePass, renderPass )
  }else if( videoPass !== null ) {
    await sg.once( videoPass )
  }

  window.requestAnimationFrame( frame )
}

frame()

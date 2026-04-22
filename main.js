import { default as seagulls } from '/gulls.js'
import { default as Video } from './video.js'

const sg      = await seagulls.init(),
      frag    = await seagulls.import( './frag.wgsl' ),
      videoFrag = await seagulls.import( './video_frag.wgsl' ),
      compute = await seagulls.import( './compute.wgsl' ),
      render  = seagulls.constants.vertex + frag,
      videoRender = seagulls.constants.vertex + videoFrag,
      size    = (window.innerWidth * window.innerHeight),
      state   = new Float32Array( size )

for( let i = 0; i < size; i++ ) {
  state[ i ] = Math.round( Math.random() )
}

const statebuffer1 = sg.buffer( state )
const statebuffer2 = sg.buffer( state )
const res = sg.uniform([ window.innerWidth, window.innerHeight ])
const screenCaptureButton = document.getElementById( 'screen_capture' )
const seedThresholdSlider = document.getElementById( 'seed_threshold' )
const seedThresholdValue = document.getElementById( 'seed_threshold_value' )
const video_sampler = sg.sampler()
const previewThreshold = sg.uniform([ 0.5, 0, 0, 0 ])
const captureCanvas = document.createElement( 'canvas' )
const captureContext = captureCanvas.getContext( '2d', { willReadFrequently:true } )
let simulationStarted = false
let capturedFrame = null

await Video.init()
const cameraTexture = Video.element !== null ? sg.video( Video.element ) : null

window.Video = Video
window.cameraTexture = cameraTexture
window.capturedFrame = capturedFrame

function getSeedThreshold() {
  if( seedThresholdSlider === null ) return 0.5

  return Number.parseFloat( seedThresholdSlider.value )
}

function updateSeedThresholdLabel() {
  if( seedThresholdSlider === null || seedThresholdValue === null ) return

  const threshold = getSeedThreshold()
  seedThresholdValue.textContent = threshold.toFixed( 2 )
  previewThreshold.value = [ threshold, 0, 0, 0 ]
}

updateSeedThresholdLabel()

if( seedThresholdSlider !== null ) {
  seedThresholdSlider.addEventListener( 'input', updateSeedThresholdLabel )
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
    sg.pingpong( statebuffer1, statebuffer2 )
  ]
})

const computePass = sg.compute({
  shader: compute,
  data: [ res, sg.pingpong( statebuffer1, statebuffer2 ) ],
  dispatchCount:  [Math.round(seagulls.width / 8), Math.round(seagulls.height/8), 1],
})

function writeState() {
  sg.device.queue.writeBuffer( statebuffer1.buffer, 0, state )
  sg.device.queue.writeBuffer( statebuffer2.buffer, 0, state )
}

function startSimulation() {
  if( simulationStarted ) return

  simulationStarted = true
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

if( screenCaptureButton !== null ) {
  screenCaptureButton.addEventListener( 'click', onScreenCapture )
}

async function frame() {
  if( simulationStarted ) {
    await sg.once( computePass, renderPass )
  }else if( videoPass !== null ) {
    await sg.once( videoPass )
  }

  window.requestAnimationFrame( frame )
}

frame()

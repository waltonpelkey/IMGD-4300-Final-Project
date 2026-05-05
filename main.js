import { default as seagulls } from '/gulls.js'
import { default as Video } from './video.js'

// Import the shaders used and other consts
const sg      = await seagulls.init(),
      frag    = await seagulls.import( `./frag.wgsl` ),
      leniaFrag = await seagulls.import( `./lenia.wgsl` ),
      videoFrag = await seagulls.import( `./video_frag.wgsl` ),
      compute = await seagulls.import( `./compute.wgsl` ),
      render  = seagulls.constants.vertex + frag,
      postRender = seagulls.constants.vertex + leniaFrag,
      videoRender = seagulls.constants.vertex + videoFrag,
      size    = (window.innerWidth * window.innerHeight),
      state   = new Float32Array( size ),
      neighborCounts = new Float32Array( size )

// Initialize the state of the simulation with random values
for( let i = 0; i < size; i++ ) {
  state[ i ] = Math.round( Math.random() )
}

// Create GPU buffers for the state and neighbor counts, and other resources like uniforms and textures
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
const simulationSpeedSlider = document.getElementById( 'simulation_speed' )
const simulationSpeedValue = document.getElementById( 'simulation_speed_value' )
const presetValuesSelect = document.getElementById( 'preset_values' )
const randomizeAgainButton = document.getElementById( 'randomize_again' )
const neighborControls = document.getElementById( 'neighbor_controls' )
const neighborRuleInputs = document.getElementById( 'neighbor_rule_inputs' )
const video_sampler = sg.sampler()
const previewThreshold = sg.uniform([ 0.5, 0, 0, 0 ])
const neighborConfig = sg.uniform([ 1, 0, 0, 0 ])
const renderTexture = sg.texture( new Uint8Array( sg.width * sg.height * 4 ) )
const feedbackTexture = sg.texture( new Uint8Array( sg.width * sg.height * 4 ) )
const renderSampler = sg.sampler()
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
let lastSimulationStepTime = 0
let ruleValues = createPresetRuleValues( 'day_and_night', getNeighborReach() )
let ruleBuffer = sg.buffer( ruleValues )

// Initialize the video element and create a texture from it
await Video.init()
const cameraTexture = Video.element !== null ? sg.video( Video.element ) : null

window.Video = Video
window.cameraTexture = cameraTexture
window.capturedFrame = capturedFrame

function getSeedThreshold() {
  // Return value from slider
  return Number.parseFloat( seedThresholdSlider.value )
}

function getNeighborReach() {
  // Return value from slider
  return Number.parseInt( neighborReachSlider.value, 10 )
}

function getSimulationSpeed() {
  // Return value from slider
  return Number.parseInt( simulationSpeedSlider.value, 10 )
}

function getMaxNeighborCount( neighborReach ) {
  // calculate the maximum number of neighbors based on the neighbor reach. For example, a reach of 1 means a 3x3 area, which has 8 neighbors, a reach of 2 means a 5x5 area, which has 24 neighbors, etc.
  return ( ( ( neighborReach * 2 ) + 1 ) * ( ( neighborReach * 2 ) + 1 ) ) - 1
}

function getRuleSlotCount( neighborReach ) {
  // The number of slots needed in the ruleset is equal to the maximum number of neighbors plus one (to account for the case of 0 neighbors)
  return getMaxNeighborCount( neighborReach ) + 1
}

function createPresetRuleValues( preset, neighborReach ) {
  // Figure out how many rules are needed for the current neighbor reach
  const slotCount = getRuleSlotCount( neighborReach )

  // Initialize all rules with default values
  const values = new Uint32Array( slotCount )
  values.fill( 1 )

  // Set specific rules based on the selected preset
  switch( preset ) {
    case 'game_of_life':
      values.set([ 0, 0, 1, 2, 0, 0, 0, 0, 0 ])
      break
    case 'day_and_night':
      values.set([ 0, 0, 0, 2, 1, 0, 2, 2, 2 ])
      break
    case 'randomized':
      // For randomied preset, assign random rules for every eligible amount of alive neighbors
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
  // Make a new rules array based on the new neighbor count
  const nextValues = new Uint32Array( getRuleSlotCount( neighborReach ) )
  
  // Copy over the previous rules if possible
  nextValues.set( previousValues.subarray( 0, Math.min( previousValues.length, nextValues.length ) ) )

  // return the new ruleset
  return nextValues
}

function replaceRuleBuffer( nextRuleValues ) {
  // store new rule values in JS and update the buffer
  ruleValues = nextRuleValues
  ruleBuffer = sg.buffer( ruleValues )
}

function updateNeighborConfig() {
  // Update the buffer that stores the neighbor counts
  const neighborReach = getNeighborReach()
  neighborConfig.value = [ neighborReach, getRuleSlotCount( neighborReach ), 0, 0 ]
}

function updateSeedThresholdLabel() {
  // Get the current slider value
  const threshold = getSeedThreshold()
  // Show the value next to the slider for the user
  seedThresholdValue.textContent = threshold.toFixed( 2 )
  // Update the uniform used for video capture seeding to reflect the new threshold
  previewThreshold.value = [ threshold, 0, 0, 0 ]
}

function updateNeighborReachLabel() {
  // show the updated value next to the slider for the user
  neighborReachValue.textContent = neighborReachSlider.value
}

function updateSimulationSpeedLabel() {
  // get slider value
  const speed = getSimulationSpeed()
  // show the speed as frames per second next to the slider for the user
  simulationSpeedValue.textContent = speed === 1 ? '1 fps' : `${speed} fps`
}

function writeRuleValues() {
  // copy rule values into the buffer
  sg.device.queue.writeBuffer( ruleBuffer.buffer, 0, ruleValues )
}

function setRule( index, value ) {
  // Update one rule at a time based on user input
  ruleValues[ index ] = ruleMapping[ value ]
  writeRuleValues()
}

function createRuleSelect( index, value ) {
  // Create the HTML elements for custom rule selection
  const label = document.createElement( 'label' )
  const labelText = document.createElement( 'span' )
  const select = document.createElement( 'select' )
  
  // Make the label show number of neighbors
  const neighborLabel = index === 1 ? '1 neighbor' : `${index} neighbors`

  // Connect the label to each dropdown
  label.htmlFor = `neighbors_${index}`
  labelText.textContent = neighborLabel

  // Give the dropdown a unique id
  select.id = `neighbors_${index}`

  // Disable the slect if the preset is not custom
  select.disabled = presetValuesSelect !== null && presetValuesSelect.value !== 'custom'

  // aDD each rule option to the dropdown
  for( const optionValue of ruleValueToOption ) {
    const option = document.createElement( 'option' )
    option.value = optionValue
    option.textContent = optionValue.replaceAll( '_', ' ' )
    select.append( option )
  }

  // Set the dropdown to the current rule value
  select.value = ruleValueToOption[ value ]

  // Listen for changes to the dropdown and update the rules accordingly
  select.addEventListener( 'change', () => {
    setRule( index, select.value )
  })

  label.append( labelText, select )

  return label
}

function renderNeighborInputs() {
  // clear previous inputs
  neighborRuleInputs.replaceChildren()

  // only show is custom preset is selected
  if( presetValuesSelect === null || presetValuesSelect.value !== 'custom' ) return

  // create a dropdown for each possible number of neighbors based on the current neighbor reach, and set it to the current rule value for that number of neighbors
  for( let i = 0; i < ruleValues.length; i++ ) {
    neighborRuleInputs.append( createRuleSelect( i, ruleValues[ i ] ) )
  }
}

function updateNeighborControlsVisibility() {
  // custom controls only show if custom preset is selected
  const showCustomControls = presetValuesSelect.value === 'custom'
  neighborControls.hidden = !showCustomControls

  // Enaable or disable the dropdowns based on whether the custom preset is selected
  for( const select of neighborControls.querySelectorAll( 'select' ) ) {
    select.disabled = !showCustomControls
  }
}

function updateRandomizeAgainVisibility() {
  // The randomize again button only shows if the randomized preset is selected, since it wouldn't make sense to randomize again if the rules aren't random
  if( randomizeAgainButton === null || presetValuesSelect === null ) return

  // Show or hide the randomize again button based on whether the randomized preset is selected
  randomizeAgainButton.hidden = presetValuesSelect.value !== 'randomized'
}

function applyRulePreset( preset ) {
  // if the preset is not custom, apply the preset rules. If it is custom, do nothing since the user can edit the rules manually and we don't want to overwrite their custom rules with a preset 
  if( preset === 'custom' ) return

  // Make new rule array for the selected preset
  replaceRuleBuffer( createPresetRuleValues( preset, getNeighborReach() ) )
  
  // Update the shaders neighbor settings
  updateNeighborConfig()
  
  // Send the new rules to the GPU
  writeRuleValues()

  // Redraw if needed
  renderNeighborInputs()
}

function updateRulesForNeighborReach() {
  // get the new neighbor reach value from the slider
  const neighborReach = getNeighborReach()
  let nextRuleValues

  if( presetValuesSelect !== null && presetValuesSelect.value === 'custom' ) {
    // if using custom rules, resize the existing rules instead of replacing them
    nextRuleValues = resizeRuleValues( ruleValues, neighborReach )
  }else{
    // if using a preset, remake the rules to match
    const preset = presetValuesSelect !== null ? presetValuesSelect.value : 'day_and_night'
    nextRuleValues = createPresetRuleValues( preset, neighborReach )
  }
  
  // Replace the rules buffer
  replaceRuleBuffer( nextRuleValues )

  // Update the shaders neighbor settings
  updateNeighborConfig()

  // copy the rules to the GPU
  writeRuleValues()

  // Rebuild the neighbor rule inputs to match the update
  renderNeighborInputs()

  // Show or hide inputs
  updateNeighborControlsVisibility()

  // Rebuild the compute pass to account for the new rule changes
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
  ],
  copy: renderTexture
})

const postProcessPass = await sg.render({
  shader: postRender,
  data: [
    res,
    renderTexture,
    renderSampler,
    sg.pingpong( statebuffer1, statebuffer2 ),
    neighborCountBuffer,
    neighborConfig,
    feedbackTexture
  ],
  copy: feedbackTexture
})

let computePass = null

// allow the compute pass to be rebuilt when rules or neighbor reach is changed, since those settings are baked into the shader and require a recompile to update
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
  // if already started, do nothing
  if( simulationStarted ) return

  // set the state of the simulation to the seeded state
  simulationStarted = true

  // reset the simulation timer
  lastSimulationStepTime = 0
}

// stop the sim, reset everything, and allow the user to reseed
function reseedSimulation() {
  simulationStarted = false
  capturedFrame = null
  lastSimulationStepTime = 0
  window.capturedFrame = capturedFrame

  if( screenCaptureButton !== null ) {
    screenCaptureButton.disabled = false
  }
}

// Take the pixel data from the captured video frame, and use it to seed the initial state of the simulation. 
// The seeding is based on the lightness of each pixel compared to a threshold, which can be adjusted by the user. This allows for interesting patterns to emerge based on the content of the video frame.
function seedStateFromPixels( pixels ) {
  // Get brightness cutoff from slider
  const threshold = getSeedThreshold()

  // loop through each pixel
  for( let i = 0; i < size; i++ ) {
    // RBGA values normalized
    const base = i * 4
    const red = pixels[ base + 0 ] / 255
    const green = pixels[ base + 1 ] / 255
    const blue = pixels[ base + 2 ] / 255

    // Calculate lightness using the average of the max and min RGB values
    const lightness = ( Math.max( red, green, blue ) + Math.min( red, green, blue ) ) * 0.5

    // If the pixel is bright enough it is seeded to alive
    state[ i ] = lightness >= threshold ? 1 : 0
  }

  // send to GPU
  writeState()
}

// Capture a frame from the video feed, and return the pixel data in a format that can be used for seeding the simulation
async function captureVideoFrame() {
  
  // Stop instead of crashing the page if something goes wrong :)
  if( captureContext === null || Video.element === null ) {
    console.warn( 'Video capture is not available.' )
    return null
  }

  // Wait for the video to be ready before trying to capture a frame
  if( Video.element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ) {
    await new Promise( resolve => {
      Video.element.onloadeddata = resolve
    })
  }

  // wait until the next animation frame
  await new Promise( resolve => window.requestAnimationFrame( () => resolve() ) )
  // set the capture canvas to the same size as the window
  captureCanvas.width = Video.element.videoWidth
  captureCanvas.height = Video.element.videoHeight
  captureContext.drawImage( Video.element, 0, 0, captureCanvas.width, captureCanvas.height )

  // save the image data
  const fullImageData = captureContext.getImageData( 0, 0, captureCanvas.width, captureCanvas.height )

  // Resize to match the canvas size used for the sim
  captureCanvas.width = sg.width
  captureCanvas.height = sg.height
  captureContext.drawImage( Video.element, 0, 0, captureCanvas.width, captureCanvas.height )

  // resized sim image data
  const simImageData = captureContext.getImageData( 0, 0, captureCanvas.width, captureCanvas.height )

  // return the size and pixel data of the captured image
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
  // if the simulation has already started, do nothing
  if( simulationStarted ) return


  try {
    // capture the one frame and get pixel data
    const videoFrame = await captureVideoFrame()

    // save the capture frame
    capturedFrame = videoFrame.full
    window.capturedFrame = capturedFrame

    // seed the simulation using the pixel data
    seedStateFromPixels( videoFrame.simPixels )
    
    // run the simulation
    startSimulation()
  } catch( error ) {
    // if anything went wrong then error
    console.warn( 'video frame capture failed', error )
  } finally {
    // if the sim did not start then reset
    // the user can try again
    if( screenCaptureButton !== null && !simulationStarted ) {
      screenCaptureButton.disabled = false
    }
  }
}

// update everything to match settings and have sim run correctly
updateSeedThresholdLabel()
updateNeighborReachLabel()
updateSimulationSpeedLabel()
updateNeighborConfig()
renderNeighborInputs()
updateNeighborControlsVisibility()
updateRandomizeAgainVisibility()
writeRuleValues()
rebuildComputePass()

// button clicks and event listeners :0
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

if( simulationSpeedSlider !== null ) {
  simulationSpeedSlider.addEventListener( 'input', updateSimulationSpeedLabel )
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

async function frame( timestamp ) {
  // if sim has started then run the shaders
  if( simulationStarted && computePass !== null ) {
    const frameInterval = 1000 / getSimulationSpeed()

    // only run the sim step if enough time has passed based on the desired simulation speed, otherwise just keep rendering the current state. This allows the user to have a consistent simulation speed even if their monitor has a higher refresh rate, and also allows them to see the changes they make to the rules in real time without having to wait for the next sim step.
    if( lastSimulationStepTime === 0 || timestamp - lastSimulationStepTime >= frameInterval ) {
      lastSimulationStepTime = timestamp

      // run the shaders in order
      await sg.once( computePass, renderPass, postProcessPass )
    }
  }else if( videoPass !== null ) { 
    // before starting sim just run video output with brightness thresholding
    await sg.once( videoPass )
  }

  window.requestAnimationFrame( frame )
}

window.requestAnimationFrame( frame )

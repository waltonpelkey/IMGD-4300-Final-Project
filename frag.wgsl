@group(0) @binding(0) var<uniform> res:   vec2f;                 // Screen resolution
@group(0) @binding(1) var<storage> state: array<f32>;            // Current state of the cell, 0.0 for dead, 1.0 for alive
@group(0) @binding(2) var<storage> unused_state: array<f32>;     // Artifact from previous iteration, was too lazy to delete and refactor main.js
@group(0) @binding(3) var<storage> neighbor_counts: array<f32>;  // Stores the number of active neighbors, useful for visualization
@group(0) @binding(4) var<uniform> neighbor_config: vec4f;       // Neighbor settings, how far out each cell searches, and the max possible neighbors (used for visualization)

@fragment 
fn fs( @builtin(position) pos : vec4f ) -> @location(0) vec4f {
  // Get the pixel coordinates
  let pixel = vec2u( pos.xy );

  // Convert to 1D index for accessing the state and neighbor count buffers
  let idx : u32 = pixel.y * u32( res.x ) + pixel.x;
  
  // Get the current state of the cell, 0.0 for dead, 1.0 for alive
  let v = state[ idx ];
  
  // Get the number of active neighbors for this cell
  let neighbor_count = neighbor_counts[ idx ];
  
  // Calculate the maximum possible neighbors based on the neighbor configuration
  let max_neighbors = max( neighbor_config.y - 1.0, 1.0 );
  
  // Calculate a mix amount for coloring based on the number of active neighbors, clamped between 0 and 1
  let mix_amount = clamp( neighbor_count / max_neighbors, 0.0, 1.0 );
  
  // Mix between white and a teal color based on the number of active neighbors, more neighbors results in a more teal color
  let live_color = mix( vec3f( 1.0, 1.0, 1.0 ), vec3f( 0.298, 0.816, 0.780 ), mix_amount );

  if( v < 0.5 ) {
    return vec4f( 0.0, 0.0, 0.0, 1.0 );
  }

  return vec4f( live_color, 1.0 ); // This color value is basically completely overwritten by the post process. But at one point it was useful for debugging
}

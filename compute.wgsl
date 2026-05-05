@group(0) @binding(0) var<uniform> res: vec2f;                              // Screen resolution
@group(0) @binding(1) var<storage> statein: array<f32>;                     // Current state of the cell
@group(0) @binding(2) var<storage, read_write> stateout: array<f32>;        // Next state of the cell
@group(0) @binding(3) var<uniform> neighbor_config: vec4f;                  // Neighbor settings, how far out each cell searches
@group(0) @binding(4) var<storage, read_write> rules: array<u32>;           // Ruleset, indexed by the number of active neighbors, value determines if the cell lives or dies
@group(0) @binding(5) var<storage, read_write> neighbor_counts: array<f32>; // Stores the number of active neighbors, useful for visualization

// Converts 2D coordinates to a 1D index, with wrapping around the edges of the screen
fn index( x:i32, y:i32 ) -> u32 {
  let resolution = vec2i(res);
  let wrapped_x = ( x + resolution.x ) % resolution.x;
  let wrapped_y = ( y + resolution.y ) % resolution.y;
  return u32( wrapped_y * resolution.x + wrapped_x );
}

@compute
@workgroup_size(8,8)
fn cs( @builtin(global_invocation_id) cell:vec3u ) {
  let cur_cell = vec3i(cell);                    // convert from unsigned to signed integer for easier math
  let i = index(cur_cell.x, cur_cell.y);         // Get the 1D index from helper
  let cell_alive = statein[ i ];                 // Get the current state of the cell, 0.0 for dead, 1.0 for alive
  let neighbor_reach = i32( neighbor_config.x ); // How far out the cell should look for neighbors, 1 means the 8 surrounding cells, 2 means a 5x5 area, etc.
  var activeNeighbors = 0u;                      // Counter variable for how many active neighbors there are

  // Loop through the neighboring cells within the specified reach, counting how many are alive. Skip the current cell itself.
  for( var offset_y = -neighbor_reach; offset_y <= neighbor_reach; offset_y++ ) {
    for( var offset_x = -neighbor_reach; offset_x <= neighbor_reach; offset_x++ ) {
      if( offset_x == 0 && offset_y == 0 ) {
        continue;
      }

      activeNeighbors += u32( statein[ index( cur_cell.x + offset_x, cur_cell.y + offset_y ) ] );
    }
  }

  // Store the number of active neighbors in a buffer for later use
  neighbor_counts[ i ] = f32( activeNeighbors );

  // Get the next state of the current cell based on the input ruleset
  let rulevalue = rules[ activeNeighbors ];
  // If the rule value is 0, the cell dies or stays dead
  if( rulevalue == 0u ) {
    stateout[ i ] = 0.0;
  } 
  // IF the rule value is 1, the cell does not change state
  else if ( rulevalue == 1u ) {
    stateout[ i ] = cell_alive;
  } 
  // If the rule value is 2, the cell becomes alive or stays alive
  else if ( rulevalue == 2u ) {
    stateout[ i ] = 1.0;
  } 
  // Edge case for invalid rules, treat it as if the cell dies or stays dead
  else {
    stateout[ i ] = 0.0;
  }
}

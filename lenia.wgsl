@group(0) @binding(0) var<uniform> res: vec2f;                  // Screen resolution
@group(0) @binding(1) var scene: texture_2d<f32>;               // Rendered scene texture
@group(0) @binding(2) var scene_sampler: sampler;               // Reading from the rendered scene texture requires a sampler, even though we are just doing point sampling
@group(0) @binding(3) var<storage> state: array<f32>;           // Current state of the cell, continuous value between 0.0 and 1.
@group(0) @binding(4) var<storage> unused_state: array<f32>;    // Artifact from previous iteration, was too lazy to delete and refactor main.js
@group(0) @binding(5) var<storage> neighbor_counts: array<f32>; // Number of active neighbors for each cell
@group(0) @binding(6) var<uniform> neighbor_config: vec4f;      // Neighbor settings, x is the reach and y is the total number including itself
@group(0) @binding(7) var previous_frame: texture_2d<f32>;      // Previous frame texture for blending frames

fn normalized_alive_density( pixel: vec2u ) -> f32 {
  // Get the 1D index for accessing the state and neighbor count buffers
  let idx = pixel.y * u32( res.x ) + pixel.x;

  // Add the number of active neighbors to the current cells data
  let alive_neighbors_including_self = neighbor_counts[ idx ] + state[ idx ];
  let total_neighbors_including_self = neighbor_config.y;

  // Return the normalized density of alive cells in the neighborhood, including the current cell. 
  // This is a value between 0 and 1 that represents how "alive" the local area is.
  return alive_neighbors_including_self / max( total_neighbors_including_self, 1.0 );
}


fn smoothed_alive_density( pixel: vec2u ) -> f32 {
  // allow negative coordinates
  let p = vec2i( pixel );

  // acc var
  var total = 0.0;

  // Loop through the 5x5 area around the current pixel
  for( var y = -2; y <= 2; y++ ) {
    for( var x = -2; x <= 2; x++ ) {
      // get nearby pixel within the area
      let sample_pixel = vec2u( clamp( p + vec2i( x, y ), vec2i( 0 ), vec2i( res ) - vec2i( 1 ) ) );
      
      // Accumulate the normalized alive density of the neighboring pixel
      total += normalized_alive_density( sample_pixel );
    }
  }

  // return the average normalized alive density in the 5x5 area
  // by averaging the values, it smooths the field
  return total / 25.0;
}

fn double_smoothed_alive_density( pixel: vec2u ) -> f32 {
  // allow negative coordinates
  let p = vec2i( pixel );
  
  // acc var
  var total = 0.0;

  // Loop through the 3x3 area around the current pixel
  for( var y = -1; y <= 1; y++ ) {
    for( var x = -1; x <= 1; x++ ) {
      // get nearby pixel within the area
      let sample_pixel = vec2u( clamp( p + vec2i( x, y ), vec2i( 0 ), vec2i( res ) - vec2i( 1 ) ) );
      
      // Accumulate the smoothed alive density of the neighboring pixel
      total += smoothed_alive_density( sample_pixel );
    }
  }

  // return the average smoothed alive density in the 3x3 area
  // This is like a blur applied to the already smoothed density
  return total / 9.0;
}

fn local_density_mean( pixel: vec2u ) -> f32 {
  // allow negative coordinates
  let p = vec2i( pixel );

  // The spread variable determines how far out the local area is for calculating the mean density. It is based on the neighbor reach, but with a minimum value to ensure it looks at a large enough area.
  let spread = i32( max( neighbor_config.x * 6.0, 6.0 ) );
  
  // acc var
  var total = 0.0;

  // Loop through the area around the current pixel defined by the spread variable
  for( var y = -1; y <= 1; y++ ) {
    for( var x = -1; x <= 1; x++ ) {
      // get nearby pixel within the area defined by the spread variable
      let sample_pixel = vec2u( clamp( p + vec2i( x, y ) * spread, vec2i( 0 ), vec2i( res ) - vec2i( 1 ) ) );
      
      // Accumulate the smoothed alive density of the neighboring pixel
      total += smoothed_alive_density( sample_pixel );
    }
  }

  // return the average smoothed alive density in the area defined by the spread variable
  // This gives an estimate of the local average density, which can be used to compare against the raw density for visualizing patterns
  return total / 9.0;
}

// This is a custom color palette function that maps a value between 0 and 1 to a color.
fn blue_green_palette( value: f32 ) -> vec3f {
  // Clamp the input value to ensure it's between 0 and 1
  let t = clamp( value, 0.0, 1.0 );

  // Define a range of colors to use in the palette
  let black = vec3f( 0.0, 0.0, 0.0 );
  let violet = vec3f( 0.18, 0.04, 0.42 );
  let blue = vec3f( 0.02, 0.20, 0.95 );
  let cyan = vec3f( 0.0, 0.82, 0.95 );
  let green = vec3f( 0.12, 0.95, 0.28 );
  let yellow = vec3f( 1.0, 0.86, 0.10 );
  let orange = vec3f( 1.0, 0.38, 0.05 );
  let red = vec3f( 1.0, 0.06, 0.04 );
  let white = vec3f( 1.0, 1.0, 0.92 );

  // Map the input value to a color by checking the ranges in order
  // return matching value, mixed between the range it corresponds with
  if( t < 0.28 ) {
    return black;
  }

  if( t < 0.40 ) {
    return mix( violet, blue, ( t - 0.28 ) / 0.12 );
  }

  if( t < 0.52 ) {
    return mix( blue, cyan, ( t - 0.40 ) / 0.12 );
  }

  if( t < 0.64 ) {
    return mix( cyan, green, ( t - 0.52 ) / 0.12 );
  }

  if( t < 0.76 ) {
    return mix( green, yellow, ( t - 0.64 ) / 0.12 );
  }

  if( t < 0.88 ) {
    return mix( yellow, orange, ( t - 0.76 ) / 0.12 );
  }

  if( t < 0.995 ) {
    return mix( orange, red, ( t - 0.88 ) / 0.115 );
  }

  return mix( red, white, ( t - 0.995 ) / 0.005 );
}

@fragment
fn fs( @builtin(position) pos : vec4f ) -> @location(0) vec4f {
  // Get the pixel coordinates
  let pixel = vec2u( pos.xy );

  // Get the raw smoothed alive density for the current pixel
  let raw_density = double_smoothed_alive_density( pixel );

  // Get the mean local density for the current pixel
  let mean_density = local_density_mean( pixel );

  // Calculate the relative density by subtracting the mean local density from the raw density. This helps to highlight areas that are denser or sparser than their local average.
  let relative_density = raw_density - mean_density;

  // Use smoothstep to transition the relative density into a value between 0 and 1 that can be used for coloring.
  let density = smoothstep( 0.01, 0.16, relative_density );

  // Map the density to a color using the custom palette
  let color = blue_green_palette( density );

  // Get the color from the previous frame at the current pixel coordinates for blending.
  let previous_color = textureSample( previous_frame, scene_sampler, pos.xy / res ).rgb;

  // Blend the current color with the previous color to create a motion blur effect.
  let smoothed_color = mix( color, previous_color, 0.68 );

  // Convert the smoothed color to grayscale.
  let gray = vec3f( dot( smoothed_color, vec3f( 0.299, 0.587, 0.114 ) ) );

  // Return the final color
  return vec4f( mix( gray, smoothed_color, 1.35 ), 1.0 );
}
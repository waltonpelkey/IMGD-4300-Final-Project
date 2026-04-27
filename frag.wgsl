@group(0) @binding(0) var<uniform> res:   vec2f;
@group(0) @binding(1) var<storage> state: array<f32>;
@group(0) @binding(2) var<storage> _unused_state: array<f32>;
@group(0) @binding(3) var<storage> neighbor_counts: array<f32>;
@group(0) @binding(4) var<uniform> neighbor_config: vec4f;

@fragment 
fn fs( @builtin(position) pos : vec4f ) -> @location(0) vec4f {
  let pixel = vec2u( pos.xy );
  let idx : u32 = pixel.y * u32( res.x ) + pixel.x;
  let v = state[ idx ];
  let neighbor_count = neighbor_counts[ idx ];
  let max_neighbors = max( neighbor_config.y - 1.0, 1.0 );
  let mix_amount = clamp( neighbor_count / max_neighbors, 0.0, 1.0 );
  let live_color = mix( vec3f( 1.0, 1.0, 1.0 ), vec3f( 0.298, 0.816, 0.780 ), mix_amount );

  if( v < 0.5 ) {
    return vec4f( 0.0, 0.0, 0.0, 1.0 );
  }

  return vec4f( live_color, 1.0 );
}

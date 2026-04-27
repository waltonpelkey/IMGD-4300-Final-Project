@group(0) @binding(0) var<uniform> res: vec2f;
@group(0) @binding(1) var<storage> statein: array<f32>;
@group(0) @binding(2) var<storage, read_write> stateout: array<f32>;
@group(0) @binding(3) var<uniform> neighbor_config: vec4f;
@group(0) @binding(4) var<storage, read_write> rules: array<u32>;
@group(0) @binding(5) var<storage, read_write> neighbor_counts: array<f32>;

fn index( x:i32, y:i32 ) -> u32 {
  let _res = vec2i(res);
  let wrapped_x = ( x + _res.x ) % _res.x;
  let wrapped_y = ( y + _res.y ) % _res.y;
  return u32( wrapped_y * _res.x + wrapped_x );
}

@compute
@workgroup_size(8,8)
fn cs( @builtin(global_invocation_id) _cell:vec3u ) {
  let cell = vec3i(_cell);
  let i = index(cell.x, cell.y);
  let cell_alive = statein[ i ];
  let neighbor_reach = i32( neighbor_config.x );
  var activeNeighbors = 0u;

  for( var offset_y = -neighbor_reach; offset_y <= neighbor_reach; offset_y++ ) {
    for( var offset_x = -neighbor_reach; offset_x <= neighbor_reach; offset_x++ ) {
      if( offset_x == 0 && offset_y == 0 ) {
        continue;
      }

      activeNeighbors += u32( statein[ index( cell.x + offset_x, cell.y + offset_y ) ] );
    }
  }

  neighbor_counts[ i ] = f32( activeNeighbors );
  let rulevalue = rules[ activeNeighbors ];

  if( rulevalue == 0u ) {
    stateout[ i ] = 0.0;
  } else if ( rulevalue == 1u ) {
    stateout[ i ] = cell_alive;
  } else if ( rulevalue == 2u ) {
    stateout[ i ] = 1.0;
  } else {
    stateout[ i ] = 0.0;
  }
}

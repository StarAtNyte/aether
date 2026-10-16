/**
 * A small structural view of three's TSL (shader node) API.
 *
 * TSL nodes are dynamically typed (swizzles, operator methods, implicit conversions) and the generated type
 * definitions reject ordinary arithmetic on them (`float` against `vec3` varyings, uniform array elements without
 * swizzles). Shader code here therefore goes through this façade: every node is an {@link Nd}, the functions we use are
 * declared with `Nd` in and out, and the single unchecked cast lives in this file.
 */
import * as TSL from 'three/tsl';
/** The typed façade over `three/tsl`. */
export const T = TSL;

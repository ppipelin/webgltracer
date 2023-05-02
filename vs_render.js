window.shaders = window.shaders || {};
window.shaders.vs_render = /* glsl */ `precision mediump float;

attribute vec3 i_vertex;
varying vec2 v_texCoord;

void main(void)
{
	v_texCoord = i_vertex.xy * 0.5 + 0.5;
	gl_Position = vec4(i_vertex, 1.0);
}
`;

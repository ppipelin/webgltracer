window.shaders = window.shaders || {};
window.shaders.vs_pathTracer = /* glsl */ `attribute vec2 i_vertex;

varying vec2 v_uv;

void main() {
	gl_Position = vec4(i_vertex, 0.0, 1.0);
	// Shift camera to match center of scene
	v_uv = i_vertex * 0.5 + 0.5;
}
`;

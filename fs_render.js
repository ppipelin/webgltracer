window.shaders = window.shaders || {};
window.shaders.fs_render = /* glsl */ `precision mediump float;

uniform sampler2D u_texture;
varying vec2 v_texCoord;

const float A = 0.15; // ShoulderStrength
const float B = 0.50; // LinearStrength
const float C = 0.10; // LinearAngle
const float D = 0.20; // ToeStrength
const float E = 0.02;
const float F = 0.30;
const float W = 10.2;

vec3 Uncharted2Tonemap(vec3 x){
	return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;
}

vec3 ACESFilm(vec3 x ){
	const float a = 2.51;
	const float b = 0.03;
	const float c = 2.43;
	const float d = 0.59;
	const float e = 0.14;
	return clamp(vec3(0.),vec3(1.),(x*(a*x+b))/(x*(c*x+d)+e));
}

vec3 ExposureCorrect(vec3 col, float linfac, float logfac){
	return linfac*(1.0 - exp(col*logfac));
}

vec3 LinearToGamma(vec3 linRGB){
	linRGB = max(linRGB, vec3(0.));
	return max(1.055 * pow(linRGB, vec3(0.416666667)) - 0.055, vec3(0.));
}

vec3 ACESFilmicToneMapping(vec3 col){
	vec3 curr = Uncharted2Tonemap(col);
	const float ExposureBias = 2.0;
	curr *= ExposureBias;
	curr /= Uncharted2Tonemap(vec3(W));
	return LinearToGamma(curr);
}

void main(void)
{
	gl_FragColor = texture2D(u_texture, v_texCoord);

	gl_FragColor.rgb = ExposureCorrect(gl_FragColor.rgb, 2.1, -0.8);
	gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
}
`;

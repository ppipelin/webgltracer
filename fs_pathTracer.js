window.shaders = window.shaders || {};
window.shaders.fs_pathTracer = /* glsl */ `precision lowp float;

#ifdef GL_FRAGMENT_PRECISION_HIGH
	precision highp float;
#else
	precision mediump float;
#endif

uniform highp float u_time;
uniform int u_objnums;
uniform int u_lights;

uniform int u_iterations;
uniform sampler2D u_texture;
uniform sampler2D u_attrtexture;

uniform vec2 u_mouse;
uniform vec3 u_keyboard;

uniform vec2 u_texsize;
uniform vec2 u_attrtexsize;

uniform int u_render_mode;

uniform int u_random_mode;

uniform int u_scene;

const int MAX_OBJ_NUM = 64;

varying vec2 v_uv;

// VARIABLES

#define UP vec3(0,0,1)
#define PI 3.1415926536
#define HALF_PI 1.5707963268
#define TWO_PI 6.28318530718
#define FOUR_PI 12.56637061436
// #define PATHS_NB 500
#define PATHS_NB 1000000

// Benchmark options
highp float seed;

// Scene/inputs parameters
const float translation_speed = 10.0;
const float rotation_speed = 0.1;

// Rendering parameters
#define MAX_DEPTH 8
#define SPPPF 2
// const float epsilon = 0.005; // OLD
const float epsilon = 0.0001;

// END_VARIABLES

// STRUCTURES
struct Camera{
	vec3 position;
	vec3 front;
	vec3 right;
	vec3 down;
	vec2 plane;
};

Camera makeCameraFromFrontRight(vec3 position, vec3 front, vec3 right, vec2 plane){
	vec3 down= cross(front, right);
	down = down/length(down);
	return Camera(position, front, right, down, plane);
}

struct PointLight{
	vec3 position;
	vec3 color;
};

struct Material{
	vec3 albedo; // Loss of energy or not
	vec3 emissive;
	float shininess;
	int bsdf_number; // 0 is lambert, 1 is mirror, 2 is optical polished, 3 is diffractive
	float eta;
};

struct Sphere{
	vec3 position;
	float radius;
	float radius2;
	Material material;
};

struct Triangle{
	vec3 v0;
	vec3 v1;
	vec3 v2;
	Material material;
};


struct Ray{
	vec3 origin;
	vec3 direction;
	float eta;
};

struct SurfaceLightSample{
	float pdf;
	vec3 point;
	vec3 normal;
};

struct DirectionSample{
	float pdf;
	float bsdf;
	vec3 direction;
};

struct Intersection{
	bool hit;
	vec3 point;
	float t;
	vec3 normal;
	Ray ray;
	Material material;
	int ptr;
};
// END_STRUCTURES

// FUNCTIONS MISC
bool isNan(float val)
{
	return (val <= 0.0 || 0.0 <= val) ? false : true;
}

void swap(inout float a, inout float b) {
	float tmp = a;
	a = b;
	b = tmp;
}

// FUNCTIONS GEOMETRY
bool sameHemisphere(vec3 w, vec3 wp) {
	return dot(w, wp) > epsilon;
}

bool samePoint(vec3 a, vec3 b){
	return length(a - b) <= epsilon;
}

vec4 quat(vec3 axis, float angle){
	vec3 u = axis * sin(angle * 0.5);
	return vec4(u, cos(angle * 0.5));
}

vec3 reflection(vec3 dir, vec3 n){
	return -dir + 2.0 * n * dot(dir, n);
}

vec3 rotate(vec4 q, vec3 v){
	vec3 u = q.xyz;
	float s = q.w;
	return 2.0 * dot(u, v) * u
				+ (s*s - dot(u, u)) * v
				+ 2.0 * s * cross(u, v);
}

vec3 rotate(vec3 axis, float angle, vec3 v) {
	float s = sin(angle * 0.5);
	vec3 u = axis * s;
	float w = cos(angle * 0.5);

	return 2.0 * dot(v, u) * u +
					(w*w  - dot(u,u)) * v +
					2.0 * w * cross(u, v);
}

vec3 sphericalToCartesian(vec2 spherical) {
	return vec3(sin(spherical.x) * cos(spherical.y), sin(spherical.x) * sin(spherical.y), cos(spherical.x));
}

vec2 cartesianToSpherical(vec3 cartesian) {
	float x = cartesian.x;
	float y = cartesian.y;
	float z = cartesian.z;
	float r = sqrt(x*x + y*y + z*z);

	//return vec2(pow(atan(y,x), 2.0), atan(sqrt(x*x + y*y)) / z); // WARN: not sure about atan2 being powered
	return vec2(acos(z/r), atan(y, x)); // atan with two params is supposed to be atan2
}

mat3 rotationMatrix(vec3 axis, float angle)	{
	axis = normalize(axis);
	float s = sin(angle);
	float c = cos(angle);
	float oc = 1.0 - c;
	return mat3(oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,
				oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c         ,  oc * axis.y * axis.z - axis.x * s,
				oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, 	oc * axis.z * axis.z + c        );
}

Ray makeRay(vec2 uv, in Camera camera) {
	vec3 direction = camera.front -
		camera.right * (0.5 - uv.x) * camera.plane.x -
		camera.down * (0.5 - uv.y) * camera.plane.y;

	return Ray(camera.position, normalize(direction), 1.0);
}

Intersection inter_dummy(in Ray ray) {
	const Material dummy_mat = Material(vec3(0), vec3(0), 0.0, 0, 0.0);
	return Intersection(false, vec3(0), 0.0, vec3(0), ray, dummy_mat, 0);
}

Intersection inter_succeeded(vec3 point, float t, vec3 normal, in Ray ray, in Material material, int ptr){
	bool ok = dot(ray.direction, normal) <= 0.0;
	normal *= (1.0 * float(ok) - 1.0 * float(!ok));
	// Assert not to close to 90 degrees
	if (dot(ray.direction, normal) > -epsilon)
	{
		const Material dummy_mat = Material(vec3(0), vec3(0), 0.0, 0, 0.0);
		return Intersection(false, vec3(0), 0.0, vec3(0), ray, dummy_mat, 0);
	}
	return Intersection(true, point, t, normal, ray, material, ptr);
}

bool raySphereIntersection(in Ray ray, in Sphere sphere, inout Intersection currentInter, int ptr){
	vec3 oc = ray.origin - sphere.position;
	float b = dot( oc, ray.direction );
	float c = dot( oc, oc ) - sphere.radius2;
	float h = b*b - c;
	if(h < 0.0) return false;
	h = sqrt( h );
	float t1 = -b-h;
	float t2 = -b+h;
	float t = 0.0;
	if(t1 < 0.0 && t2 < 0.0) return false;
	else if(t1 > 0.0) {
		if(t2 > 0.0) t = min(t1,t2);
		else t = t1;
	} else t = t2;
	if(currentInter.hit && t > currentInter.t) return true;
	vec3 point = ray.origin + t * ray.direction;
	vec3 normal = (point - sphere.position) / sphere.radius;
	currentInter = inter_succeeded(point, t, normal, ray, sphere.material, ptr);
	return true;
}

// triangle designed by vertices v0, v1 and v2
bool rayTriangleIntersection(in Ray ray, in Triangle tri, inout Intersection currentInter, int ptr)
{
	vec3 v1v0 = tri.v1 - tri.v0;
	vec3 v2v0 = tri.v2 - tri.v0;
	vec3 rov0 = ray.origin - tri.v0;
	vec3  n = cross( v1v0, v2v0 );
	vec3  q = cross( rov0, ray.direction );
	float d = 1.0/dot( ray.direction, n );
	float u = d*dot( -q, v2v0 );
	float v = d*dot(  q, v1v0 );
	float t = d*dot( -n, rov0 );
	if(u < 0.0 || u > 1.0 || v < 0.0 || (u + v) > 1.0 || t <= 0.0) return false;
	if(currentInter.hit && t > currentInter.t) return true;
	vec3 point = ray.origin + ray.direction * t;
	currentInter = inter_succeeded(point, t, normalize(n), ray, tri.material, ptr);
	return true;
}

bool raySceneIntersection(in Ray ray, inout Intersection inter){
	float attw = u_attrtexsize.r;
	float atth = u_attrtexsize.g;
	int inter_selected = -1;
	for (int i = 0; i < MAX_OBJ_NUM; ++i){
		if (i >= u_objnums)
			break;

		float fix = float(i);
		float fiy = 0.0;
		int type = int(texture2D(u_attrtexture, vec2((7.0 * fix)/attw,fiy/atth)).r);

		const Material dummy_mat = Material(vec3(0), vec3(0), 0.0, 0, 0.0);
		if (type == 0)
		{
			vec3 position = 200.0 * (texture2D(u_attrtexture, vec2((7.0 * fix + 1.0)/attw,fiy/atth)).rgb - 0.5);
			float radius = 50.0 * (texture2D(u_attrtexture, vec2((7.0 * fix + 2.0)/attw,fiy/atth)).r); // radius is encoded differently to enhance precision
			Sphere tmp = Sphere(position, radius, radius*radius, dummy_mat);
			if (raySphereIntersection(ray, tmp, inter, i) && inter.ptr == i)
			{
				inter_selected = i;
			}
		}
		else if (type == 1)
		{
			vec3 v1 = 200.0 * (texture2D(u_attrtexture, vec2((7.0 * fix + 1.0)/attw,fiy/atth)).rgb - 0.5);
			vec3 v2 = 200.0 * (texture2D(u_attrtexture, vec2((7.0 * fix + 2.0)/attw,fiy/atth)).rgb - 0.5);
			vec3 v3 = 200.0 * (texture2D(u_attrtexture, vec2((7.0 * fix + 3.0)/attw,fiy/atth)).rgb - 0.5);
			Triangle tmp = Triangle(v1, v2, v3, dummy_mat);
			if (rayTriangleIntersection(ray, tmp, inter, i) && inter.ptr == i)
			{
				inter_selected = i;
			}
		}
	}
	// Compute material from texture once we found the closest intersecting
	if (inter_selected != -1)
	{
		float fix = float(inter_selected);
		float fiy = 0.0;
		vec3 albedo = texture2D(u_attrtexture, vec2((7.0 * fix + 4.0)/attw,fiy/atth)).rgb;
		vec3 emissive = texture2D(u_attrtexture, vec2((7.0 * fix + 5.0)/attw,fiy/atth)).rgb;
		float eta = texture2D(u_attrtexture, vec2((7.0 * fix + 6.0)/attw,fiy/atth)).r * 10.0;
		float shininess = texture2D(u_attrtexture, vec2((7.0 * fix + 6.0)/attw,fiy/atth)).g;
		int bsdf_number = int(texture2D(u_attrtexture, vec2((7.0 * fix)/attw,fiy/atth)).b * 3.0);
		inter.material = Material(albedo, emissive, shininess, bsdf_number, eta);
	}
	return inter.hit;
}

bool visibility(in Ray ray, vec3 point){
	Intersection inter = inter_dummy(ray);
	raySceneIntersection(ray, inter);
	return inter.hit && samePoint(inter.point, point);
}

// FUNCTIONS MATERIALS
bool isEmissive(const in Material mat){
	return mat.emissive.r > epsilon || mat.emissive.g > epsilon || mat.emissive.b > epsilon;
}

bool isColor(vec3 c) {
	float treshold = 1000000000.0;
	return (c.x >= 0.0 && c.x < treshold) && (c.y >= 0.0 && c.y < treshold) && (c.z >= 0.0 && c.z < treshold);
}

bool isBlack(vec3 c) {
	return c.x <= 0.0 && c.y <= 0.0 && c.z <= 0.0;
}

float BSDF_lambert(in vec2 i, in vec2 o) {
	return 1.0/PI;
}

float BSDF_mirror(in vec2 i, in vec2 o) {
	return 0.0;
	// return float(i.x - o.x < epsilon) / PI; // dirac
}

float BSDF_fresnel(in vec2 i, in vec2 o) {
	return 0.0;
}

float BSDF(in Material mat, in vec2 i, in vec2 o) {
	if(mat.bsdf_number == 0)
		return BSDF_lambert(i, o);
	if(mat.bsdf_number == 1)
		return BSDF_mirror(i, o);
	if(mat.bsdf_number == 2 || mat.bsdf_number == 3)
		return BSDF_fresnel(i, o);
	return 0.0;
}

// FUNCTIONS RENDERING
highp float rand1() {
	return fract(sin(seed += 1.0)*43758.5453123);
}

highp vec2 rand2() {
	return fract(sin(vec2(seed+=0.1,seed+=0.1))*vec2(43758.5453123,22578.1459123));
}

highp vec3 rand3() {
	return fract(sin(vec3(seed+=0.1,seed+=0.1,seed+=0.1))*vec3(43758.5453123,22578.1459123,19642.3490423));
}

vec3 sample_cosine(in Intersection inter, inout float pdf, inout vec3 new_dir_local) {
	highp float phi = rand1() * 2.0 * PI;
	highp float theta = acos(sqrt(1.0 - rand1()));
	float sintheta = sin(theta);
	float costheta = abs(cos(theta));
	new_dir_local = vec3(sintheta * cos(phi), sintheta * sin(phi), costheta);

	if(!sameHemisphere(inter.normal, new_dir_local))
		new_dir_local *= -1.0;
	pdf = costheta / PI;
	return inter.material.albedo / PI;
}

vec3 sample_mirror(in Intersection inter, inout float pdf, inout vec3 new_dir_local) {
	new_dir_local = reflection(-normalize(inter.ray.direction), inter.normal);
	pdf = 1.0;
	if(!sameHemisphere(inter.normal, new_dir_local))
		new_dir_local *= -1.0;

	float acostheta = abs(normalize(new_dir_local.z));
	return inter.material.albedo / acostheta;
}

// See https://pbr-book.org/3ed-2018/Reflection_Models/Specular_Reflection_and_Transmission
float FrDielectric(float cosThetaI, float etaI, float etaT) {
	cosThetaI = clamp(cosThetaI, -1.0, 1.0);

	// Swap indices of refract if necessary
	bool entering = cosThetaI > 0.0;
	if (!entering) {
		swap(etaI, etaT);
		cosThetaI = abs(cosThetaI);
	}

	// Snells law
	// Since sin2(x) + cos2(x) = 1
	float sinThetaI = sqrt(max(0.0, 1.0 - cosThetaI * cosThetaI));
	float sinThetaT = etaI / etaT * sinThetaI;
	// Handle total internal reflection
	if (sinThetaT >= 1.0)
		return 1.0;

	float cosThetaT = sqrt(max(0.0, 1.0 - sinThetaT * sinThetaT));

	float Rparl = ((etaT * cosThetaI) - (etaI * cosThetaT)) /
						((etaT * cosThetaI) + (etaI * cosThetaT));
	float Rperp = ((etaI * cosThetaI) - (etaT * cosThetaT)) /
						((etaI * cosThetaI) + (etaT * cosThetaT));
	return (Rparl * Rparl + Rperp * Rperp) / 2.0;
}

vec3 sample_fresnel(in Intersection inter, inout float pdf, inout vec3 new_dir_local) {
	float cost = dot(-inter.ray.direction, inter.normal);
	float eta1 = inter.ray.eta, eta2 = inter.material.eta;
	vec3 f = vec3(1);

	bool entering = cost > 0.0; // does not work for triangles that are not oriented correctly
	//bool entering = eta1 != eta2; // more robust in many case but imperfect

	if(!entering) {
		swap(eta1,eta2);
		//eta2 = 1.0; // going outside of material (suppose that no surfaces directly touches another one)
	}

	float fresnel_term = FrDielectric(cost, eta1, eta2);

	if(rand1() > fresnel_term){
		// Refract
		float eta = eta1/eta2;
		float sin2ThetaI = max(0.0, 1.0 - cost * cost);
		float sin2ThetaT = eta * eta * sin2ThetaI;
		// Handle total internal reflection for transmission
		if (sin2ThetaT >= 1.0) return vec3(0);
		float cosThetaT = sqrt(1.0 - sin2ThetaT);
		new_dir_local = normalize(eta * -(-inter.ray.direction) + (eta * cost - cosThetaT) * inter.normal);

		f *= (1.0 - fresnel_term) / abs(cosThetaT);
		pdf = 1.0;
	}
	else {
		// Reflect
		f *= fresnel_term * abs(cost); // cos theta_in same as cos theta_out
		pdf = 1.0;
		float void_pdf;
		sample_mirror(inter, void_pdf, new_dir_local);
	}

	return f * inter.material.albedo;
}

void createCoordinateSystem(in vec3 normal, out vec3 Nt, out vec3 Nb) {
	if (abs(normal.x) > abs(normal.y))
		Nt = vec3(normal.z, 0, -normal.x) / sqrt(normal.x * normal.x + normal.z * normal.z);
	else
		Nt = vec3(0, -normal.z, normal.y) / sqrt(normal.y * normal.y + normal.z * normal.z);
	Nb = cross(normal, Nt);
}

// https://www.scratchapixel.com/lessons/3d-basic-rendering/global-illumination-path-tracing/global-illumination-path-tracing-practical-implementation
vec3 worldToLocal(in vec3 normal , vec3 dir) {
	vec3 Nt, Nb;
	createCoordinateSystem(normal, Nt, Nb);
	return vec3(
		dir.x * Nb.x + dir.y * normal.x + dir.z * Nt.x,
		dir.x * Nb.y + dir.y * normal.y + dir.z * Nt.y,
		dir.x * Nb.z + dir.y * normal.z + dir.z * Nt.z);
}

// not sure about this trick
vec3 localToWorld(vec3 dir) {
	return worldToLocal(vec3(0,1,0), dir);
}

// wvl in nm
// http://www.physics.sfasu.edu/astro/color/spectra.html
vec3 wvl_to_rgb(float wvl)
{
	float Gamma = 0.80;
	float factor, red, green, blue;

	if((wvl >= 380.0) && (wvl<440.0)){
		red = -(wvl - 440.0) / (440.0 - 380.0);
		green = 0.0;
		blue = 1.0;
	}else if((wvl >= 440.0) && (wvl<490.0)){
		red = 0.0;
		green = (wvl - 440.0) / (490.0 - 440.0);
		blue = 1.0;
	}else if((wvl >= 490.0) && (wvl<510.0)){
		red = 0.0;
		green = 1.0;
		blue = -(wvl - 510.0) / (510.0 - 490.0);
	}else if((wvl >= 510.0) && (wvl<580.0)){
		red = (wvl - 510.0) / (580.0 - 510.0);
		green = 1.0;
		blue = 0.0;
	}else if((wvl >= 580.0) && (wvl<645.0)){
		red = 1.0;
		green = -(wvl - 645.0) / (645.0 - 580.0);
		blue = 0.0;
	}else if((wvl >= 645.0) && (wvl<781.0)){
		red = 1.0;
		green = 0.0;
		blue = 0.0;
	}else{
		red = 0.0;
		green = 0.0;
		blue = 0.0;
	};

	// Let the intensity fall off near the vision limits
	if((wvl >= 380.0) && (wvl<420.0)){
		factor = 0.3 + 0.7*(wvl - 380.0) / (420.0 - 380.0);
	}else if((wvl >= 420.0) && (wvl<701.0)){
		factor = 1.0;
	}else if((wvl >= 701.0) && (wvl<781.0)){
		factor = 0.3 + 0.7*(780.0 - wvl) / (780.0 - 700.0);
	}else{
		factor = 0.0;
	};

	if (red != 0.0){
		red = pow(red * factor, Gamma);
	}
	if (green != 0.0){
		green = pow(green * factor, Gamma);
	}
	if (blue != 0.0){
		blue = pow(blue * factor, Gamma);
	}
	return vec3(red,green,blue);
}

vec3 sample_BSDF(in Intersection inter, inout DirectionSample ds){
	vec3 old_dir_world = normalize(-inter.ray.direction);
	vec2 old_dir_world_spherical = cartesianToSpherical(old_dir_world);

	vec3 old_dir_local = worldToLocal(inter.normal, old_dir_world);
	vec2 old_dir_local_spherical = cartesianToSpherical(old_dir_local);

	vec3 new_dir_local, f;

	if(inter.material.bsdf_number == 0)
		f = sample_cosine(inter, ds.pdf, new_dir_local);
	else if(inter.material.bsdf_number == 1)
		f = sample_mirror(inter, ds.pdf, new_dir_local);
	else if(inter.material.bsdf_number == 2)
		f = sample_fresnel(inter, ds.pdf, new_dir_local);
	else if(inter.material.bsdf_number == 3)
	{
		// Spectral dispersion
		float picked_rnd = rand1();
		float wvl_selection = picked_rnd * (750.0-350.0) + 350.0;

		f = wvl_to_rgb(wvl_selection);

		float new_eta = picked_rnd * (6.6 - 2.0) + 2.0;
		inter.material.eta = new_eta;
		f *= sample_fresnel(inter, ds.pdf, new_dir_local);
	}
	if (ds.pdf == 0.0) return vec3(0);

	vec3 new_dir_world = localToWorld(new_dir_local);
	// new_dir_world = new_dir_local;

	ds.direction = new_dir_world;
	return f;
}

// Sampling from pbrt
vec2 UniformSampleTriangle(in vec2 u) {
	float su0 = sqrt(u.x);
	return vec2(1.0 - su0, u.y * su0);
}

void sampleTriangleArea(vec3 viewer, in Triangle tri, inout SurfaceLightSample sls) {
	vec2 u = rand2();
	vec2 b = UniformSampleTriangle(u);
	// float tri_area = abs(
	// 	tri.v0.x * (tri.v1.y - tri.v2.y)+
	// 	tri.v1.x * (tri.v2.y - tri.v0.y)+
	// 	tri.v2.x * (tri.v0.y - tri.v1.y));
	float tri_area = length(0.5 * cross(tri.v1 - tri.v0, tri.v2 - tri.v0));
	sls.point = b.x * tri.v0 + b.y * tri.v1 + (1.0 - b.x - b.y) * tri.v2;
	sls.normal = normalize(vec3(cross(tri.v1 - tri.v0, tri.v2 - tri.v0)));
	sls.pdf = 1.0 / tri_area;
}

// https://www.akalin.com/sampling-visible-sphere
void sampleSphereSA(vec3 viewer, in Sphere sphere, inout SurfaceLightSample sls) {
	// get costheta and phi
	vec3 main_direction = (viewer - sphere.position);
	float d = length(main_direction);
	main_direction /= d;
	float d2 = d*d;
	float sinthetamax = sphere.radius / d;

	// float thetamax = asin(sinthetamax);
	float costhetamax = sqrt(1.0 - sinthetamax * sinthetamax); //cos(thetamax);

	highp float costheta = 1.0 - rand1() * (1.0 - costhetamax);

	float sintheta = sqrt(1.0 - costheta * costheta); //sin(acos(costheta))
	highp float phi = rand1() * TWO_PI;

	// D = 1 - d² sin² θ / r²
	float sintheta2 =  sintheta * sintheta;
	float D = 1.0 - d2 * sintheta2 / sphere.radius2;
	bool D_positive = D > 0.0;

	float cosalpha = float(D_positive) * (sintheta2 / sinthetamax + costheta * sqrt(abs(D)))
					+ float(!D_positive) * sinthetamax;

	float sinalpha = sin(acos(cosalpha)); //sqrt(1.0 - cosalpha * cosalpha);

	vec3 direction = vec3(sinalpha * cos(phi), sinalpha * sin(phi), cosalpha);
	if(abs(main_direction.z) > (1.0 - epsilon)){
		sls.normal = direction * sign(main_direction.z);
	}
	else{
		vec3 axis = normalize(cross(UP, main_direction));
		float angle = acos(main_direction.z);

		sls.normal = rotate(axis, angle, direction);
	}
	sls.point = sphere.position + sphere.radius * sls.normal;
	float solid_angle = TWO_PI * (1.0 - costhetamax);
	sls.pdf = 1.0 / solid_angle;
}

vec3 estimateDirect(in Intersection inter, in SurfaceLightSample sls, in vec3 Le, in bool from_area_to_SA) {
	float pdf_light = sls.pdf;// / float(u_lights); // dividing because using sampleOneLight
	vec3 pointToSample = sls.point - inter.point;
	vec3 pointToSample_normalized = normalize(pointToSample);

	if(!isNan(pdf_light) && pdf_light != 0.0 && !isNan(Le[0]) && !isNan(Le[1]) && !isNan(Le[2]) && !isBlack(Le)) {
		vec3 bsdf = inter.material.albedo * BSDF(inter.material, cartesianToSpherical(-inter.ray.direction), cartesianToSpherical(pointToSample));
		float cosi = abs(dot(inter.normal, pointToSample_normalized));
		vec3 f = bsdf * cosi; // bounce toward light f, called f in pbrt
		if (!isNan(f[0]) && !isNan(f[1]) && !isNan(f[2]) && !isBlack(f))
		{
			float dist = length(pointToSample);
			if(from_area_to_SA) {
				float cosl = abs(dot(sls.normal, -pointToSample_normalized));
				float SA_to_area = (dist*dist) / cosl;
				pdf_light *= SA_to_area;
				// if (pdf_light > 1000000.0) return vec3(0.0);
			}

			Ray ray_light = Ray(inter.point + pointToSample_normalized * epsilon, pointToSample_normalized, 1.0); // Better correlates with naive
			// Ray ray_light = Ray(inter.point + inter.normal * epsilon, pointToSample_normalized, 1.0); // Ray origin is shifted along normal instead of pointToSample
			float V = float(visibility(ray_light, sls.point));
			return V * Le * f / pdf_light;
		}
	}
	return vec3(0);
}

vec3 sampleOneLight(in Intersection inter){
	vec3 Li_all;
	SurfaceLightSample sls;

	float attw = u_attrtexsize.r;
	float atth = u_attrtexsize.g;

	// Select
	int selected = int(rand1() * float(u_lights));

	// Find
	int cnt = 0; // Counter for selecting ith light
	for (int i = 0; i < MAX_OBJ_NUM; ++i){
		if (i >= u_objnums)
			break;
		float fix = float(i);
		float fiy = 0.0;
		vec3 emissive = texture2D(u_attrtexture, vec2((7.0 * fix + 5.0)/attw,fiy/atth)).rgb;

		if (isBlack(emissive))
			continue;
		else if(cnt++ != selected)
			continue;

		int type = int(texture2D(u_attrtexture, vec2((7.0 * fix)/attw,fiy/atth)).r);

		const Material material = Material(vec3(0), vec3(0), 0.0, 0, 0.0);

		if (type == 0)
		{
			vec3 position = 200.0 * (texture2D(u_attrtexture, vec2((7.0 * fix + 1.0)/attw,fiy/atth)).rgb - 0.5);
			float radius = 50.0 * (texture2D(u_attrtexture, vec2((7.0 * fix + 2.0)/attw,fiy/atth)).r); // radius is encoded differently to enhance precision
			Sphere tmp = Sphere(position, radius, radius*radius, material);
			sampleSphereSA(inter.point, tmp, sls); // pdf in Solid Angle
			return float(u_lights) * estimateDirect(inter, sls, emissive, false);
		}
		else if (type == 1)
		{
			vec3 v1 = 200.0 * (texture2D(u_attrtexture, vec2((7.0 * fix + 1.0)/attw,fiy/atth)).rgb - 0.5);
			vec3 v2 = 200.0 * (texture2D(u_attrtexture, vec2((7.0 * fix + 2.0)/attw,fiy/atth)).rgb - 0.5);
			vec3 v3 = 200.0 * (texture2D(u_attrtexture, vec2((7.0 * fix + 3.0)/attw,fiy/atth)).rgb - 0.5);
			Triangle tmp = Triangle(v1, v2, v3, material);

			sampleTriangleArea(inter.point, tmp, sls); // pdf in Area converted to SA
			return float(u_lights) * estimateDirect(inter, sls, emissive, true);
		}
	}
	// return Li_all / float(scene.nbLights);
	// return Li_all * float(scene.nbLights);
}

vec3 traceNormals(in Ray ray, bool xray) {
	vec3 res = vec3(0);
	vec3 color_total;
	if(u_iterations <= 0) {
		Intersection inter;
		inter = inter_dummy(ray);
		for(float depth = 1.0; depth < 5.0; ++depth) {
			raySceneIntersection(ray, inter);
			ray.origin = inter.point;
			ray.direction += ray.direction*epsilon;
			color_total += abs(inter.normal) / depth;
			if (!xray) break;
		}
		vec3 color_tex;
		if(u_iterations > 0)
			color_tex = texture2D(u_texture, vec2(gl_FragCoord.x / u_texsize.r, gl_FragCoord.y / u_texsize.g)).rgb; // previous frame
		if(isColor(color_total))
			res += (color_tex * float(u_iterations) + color_total) / (float(u_iterations) + 1.0);
	} else
		res = texture2D(u_texture, vec2(gl_FragCoord.x / u_texsize.r, gl_FragCoord.y / u_texsize.g)).rgb; // previous frame
	return res;
}

vec3 traceRay(in Ray ray, bool shadow) {
	vec3 res = vec3(0);
	vec3 color_total;
	if(u_iterations <= PATHS_NB) {
		Intersection inter;
		inter = inter_dummy(ray);
		if(raySceneIntersection(ray, inter)) {
			if(isEmissive(inter.material)) {
				color_total += inter.material.emissive;
			} else {
				// Shadowed ?
				if(!shadow){
					color_total += dot(-ray.direction, inter.normal) * inter.material.albedo;
				}
				else
				{
					color_total += sampleOneLight(inter);
				}
			}

			vec3 color_tex;
			if(u_iterations > 0)
				color_tex = texture2D(u_texture, vec2(gl_FragCoord.x / u_texsize.r, gl_FragCoord.y / u_texsize.g)).rgb; // previous frame
			if(isColor(color_total))
				res += (color_tex * float(u_iterations) + color_total) / (float(u_iterations) + 1.0);
		}
	} else
		res = texture2D(u_texture, vec2(gl_FragCoord.x / u_texsize.r, gl_FragCoord.y / u_texsize.g)).rgb; // previous frame

	return res;
}

vec3 tracePath(in Ray ray, bool naive, bool lastLight) {
	// res is pixel color
	// color_total is computed color (needs to be scaled based on u_iterations)
	// beta is propagating color
	vec3 res, color_total, beta = vec3(1);
	bool spec_current = false;
	DirectionSample ds;
	ds.pdf = 1.0;

	if(u_iterations <= PATHS_NB) {
		Intersection inter;

		for(int depth = 0; depth < MAX_DEPTH; ++depth) {
			inter = inter_dummy(ray); // needed to init hit to false
			if(raySceneIntersection(ray, inter)) {
				// Emissive material
				if(isEmissive(inter.material)) {
					if(depth == 0 || naive || spec_current) {
						color_total += beta * inter.material.emissive; // lights do not have albedo // TODO: study different kind of lights
					} else if(lastLight && depth < MAX_DEPTH-1) {
						color_total += beta * inter.material.emissive;
					}
				}
				if(!naive && (!lastLight || lastLight && depth == MAX_DEPTH-1)) {
					// color_total += beta * sampleAllLights(inter);
					color_total += beta * sampleOneLight(inter);
				}

				// Surface sampling for next bounce
				vec3 f = sample_BSDF(inter, ds);
				if (isBlack(f) || ds.pdf == 0.0 || isNan(ds.pdf)) break;

				float acost = abs(dot(ds.direction, inter.normal));
				beta *= f * acost / ds.pdf; // beta propagates cosine, albedo and bsdf value through the path

				spec_current = inter.material.bsdf_number == 1 || inter.material.bsdf_number == 2 || inter.material.bsdf_number == 3;
				ray = Ray(inter.point + ds.direction*epsilon, ds.direction, inter.material.eta);
			}
			else {
				break; // No intersect
			}
		}
		vec3 color_tex;
		if(u_iterations > 0)
			color_tex = texture2D(u_texture, vec2(gl_FragCoord.x / u_texsize.r, gl_FragCoord.y / u_texsize.g)).rgb; // previous frame
		if(isColor(color_total))
			res = (color_tex * float(u_iterations) + color_total) / (float(u_iterations) + 1.0);
	} else {
		res = texture2D(u_texture, vec2(gl_FragCoord.x / u_texsize.r, gl_FragCoord.y / u_texsize.g)).rgb; // Static image
	}
	return res;
}

void main() {
	vec3 delta_p = vec3(0,0,0);
	delta_p.x += u_keyboard.x;
	delta_p.y += u_keyboard.y;
	delta_p.z += u_keyboard.z;
	vec2 delta_r = vec2(0);
	delta_r.x += u_mouse.x * rotation_speed;
	delta_r.y += u_mouse.y * rotation_speed;
	vec2 uv_swap = v_uv;
	uv_swap.x = -v_uv.x + 1.0;

	// Initialize from attr
	vec3 position = vec3(-15, -0.35, 0);
	vec2 rotation = vec2(HALF_PI, 0);

	rotation += delta_r;
	vec3 front = sphericalToCartesian(rotation);
	vec3 right = normalize(cross(UP, front));

	position += front * delta_p.x;
	position += right * delta_p.y;
	position.z += delta_p.z;

	vec2 cplane = vec2(u_texsize.r,u_texsize.g) / ((u_texsize.r+u_texsize.g)/2.0);
	Camera camera = makeCameraFromFrontRight(position, front, right, cplane);

	vec3 color;

	for(int i = 1 ; i <= SPPPF; ++i) // Make SPPPF samples per pixel per frame
	{
		if(u_random_mode == 0)
			seed = u_time * sin(u_time) + (gl_FragCoord.x + u_texsize.r * gl_FragCoord.y) / u_texsize.g;
		else if(u_random_mode == 1)
			seed = u_time;
		else if(u_random_mode == 2)
			seed = u_time + (gl_FragCoord.x * gl_FragCoord.y);
		else if(u_random_mode == 3)
			seed = u_time;

		Ray ray = makeRay(uv_swap, camera);
		vec3 tmp;
		if (u_render_mode == -1)
			tmp = traceNormals(ray, false); // Normals
		else if (u_render_mode == 0)
			tmp = traceRay(ray, false); // Raytracing
		else if (u_render_mode == 1)
			tmp = traceRay(ray, true); // Raytracing shadowed
		else if (u_render_mode == 2)
			tmp = tracePath(ray, true, false); // Path tracing naive
		else if (u_render_mode == 3)
			tmp = tracePath(ray, false, true); // Path tracing last (sample light on last vertex)
		else if (u_render_mode == 4)
			tmp = tracePath(ray, false, false); // Path tracing iterative (sample light on all vertices)
		if(isColor(tmp))
			color += tmp;
	}

	color /= float(SPPPF);
	gl_FragColor = vec4(color, 1.0);
}`;

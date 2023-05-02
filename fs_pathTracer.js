window.shaders = window.shaders || {};
window.shaders.fs_pathTracer = /* glsl */ `precision lowp float;

#ifdef GL_FRAGMENT_PRECISION_HIGH
	precision highp float;
#else
	precision mediump float;
#endif

uniform highp float u_time;

uniform int u_iterations;
uniform sampler2D u_texture;

uniform vec2 mouse;
uniform vec3 keyboard;

uniform vec2 u_texsize;

uniform int u_render_mode;

uniform int u_random_mode;

uniform int u_scene;

varying vec2 v_uv;

// VARIABLES

#define UP vec3(0,0,1)
#define MAXLIGHTS 15
#define MAXSPHERES 20
#define MAXTRIANGLES 80
#define PI 3.1415926536
#define HALF_PI 1.5707963268
#define TWO_PI 6.28318530718
#define FOUR_PI 12.56637061436
// #define PATHS_NB 500
#define PATHS_NB 1000000

// Benchmark options
highp float seed;

// Scene/inputs parameters
const float scene_scale = 1.0;
const float translation_speed = 10.0 * scene_scale;
const float rotation_speed = 0.1;
const vec3 canvas = vec3(512,512,0);
const vec4 INITIAL_POS_SPP = scene_scale * vec4(-40.0,0.0,-10.0,1.0);
const vec4 INITIAL_ROT_TECH = vec4(HALF_PI + 0.1,0,0,0);

// Rendering parameters
#define MAX_DEPTH 16
#define SPPPF 2
// const float epsilon = scene_scale * 0.005; // OLD
const float epsilon = scene_scale * 0.0001;

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
	int bsdf_number; // 0 is lambert, 1 is mirror, 2 is optical polished
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

struct Scene{
	Camera camera;
	PointLight[MAXLIGHTS] lights;
	Sphere[MAXSPHERES] spheres;
	Triangle[MAXTRIANGLES] triangles;
	int[MAXSPHERES] light_spheres;
	int[MAXTRIANGLES] light_triangles;
	int nbLights;
	int nbLightSpheres;
	int nbLightTriangles;
	int nbSpheres;
	int nbTriangles;
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
	int tptr;
	int sptr;
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
	return Intersection(false, vec3(0), 0.0, vec3(0), ray, dummy_mat, 0, 0);
}

Intersection inter_succeeded(vec3 point, float t, vec3 normal, in Ray ray, in Material material, int tptr, int sptr){
	bool ok = dot(ray.direction, normal) <= 0.0;
	normal *= (1.0 * float(ok) - 1.0 * float(!ok));
	// Assert not to close to 90 degrees
	if (dot(ray.direction, normal) > -epsilon)
	{
		const Material dummy_mat = Material(vec3(0), vec3(0), 0.0, 0, 0.0);
		return Intersection(false, vec3(0), 0.0, vec3(0), ray, dummy_mat, 0, 0);
	}
	return Intersection(true, point, t, normal, ray, material, tptr, sptr);
}

bool raySphereIntersection(in Ray ray, in Sphere sphere, inout Intersection currentInter, int sptr){
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
	if(t > currentInter.t && currentInter.hit) return true;
	vec3 point = ray.origin + t * ray.direction;
	vec3 normal = (point - sphere.position) / sphere.radius;
	currentInter = inter_succeeded(point, t, normal, ray, sphere.material, -1, sptr);
	return true;
}

// triangle designed by vertices v0, v1 and v2
bool rayTriangleIntersection(in Ray ray,  in Triangle tri, inout Intersection currentInter, int tptr)
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
	if(t > currentInter.t && currentInter.hit) return true;
	vec3 point = ray.origin + ray.direction * t;
	currentInter = inter_succeeded(point, t, normalize(n), ray, tri.material, tptr, -1);
	return true;
}

bool raySceneIntersection(in Ray ray, in Scene scene, inout Intersection inter){
	for(int i = 0 ; i < MAXSPHERES ; ++i){
		if(i < scene.nbSpheres)
			raySphereIntersection(ray, scene.spheres[i], inter, i);
	}
	for(int i = 0 ; i < MAXTRIANGLES ; ++i){
		if(i < scene.nbTriangles)
			rayTriangleIntersection(ray, scene.triangles[i], inter, i);
	}
	return inter.hit;
}

bool visibility(in Ray ray, in Scene scene, vec3 point){
	Intersection inter = inter_dummy(ray);
	raySceneIntersection(ray, scene, inter);
	return inter.hit && samePoint(inter.point, point);
}

// FUNCTIONS MATERIALS
bool isEmissive(in Material mat){
	return mat.emissive.r > 0.0 || mat.emissive.g > 0.0 || mat.emissive.b > 0.0;
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
	if(mat.bsdf_number == 2)
		return BSDF_fresnel(i, o);
	return 0.0;
}

// FUNCTIONS SCENE
void addQuad(vec3 position, vec2 scale, vec3 axis, float angle, in Material material, inout Scene scene){
	if (scene.nbTriangles + 2 > MAXTRIANGLES)
	{
		return;
	}

	mat3 R = rotationMatrix(axis, angle);
	vec3 fl = R * vec3(-0.5*scale.x, -0.5*scale.y, 0) + position;
	vec3 fr = R * vec3(-0.5*scale.x, 0.5*scale.y, 0) + position;
	vec3 bl = R * vec3(0.5*scale.x, -0.5*scale.y, 0) + position;
	vec3 br = R * vec3(0.5*scale.x, 0.5*scale.y, 0) + position;

	// for (int k = scene.nbTriangles; k < scene.nbTriangles + 2; ++k) // Does not work cause bounds are not const
	// 	scene.triangles[k] = Triangle(fl, fr, br, material); // k is a constant
	for (int k = 0; k < MAXTRIANGLES; ++k)
		if(k == scene.nbTriangles)
			scene.triangles[k] = Triangle(fl, fr, br, material); // k is a constant
		else if(k == scene.nbTriangles+1)
			scene.triangles[k] = Triangle(br, bl, fl, material);

	scene.nbTriangles += 2;

	if(isEmissive(material) && scene.nbLightTriangles + 1 <= MAXLIGHTS){
		for (int k = 0; k < MAXLIGHTS; ++k){
			if(k == scene.nbLightTriangles)
				scene.light_triangles[k] = scene.nbTriangles-2; // k is a constant
			if(k == scene.nbLightTriangles+1)
				scene.light_triangles[k] = scene.nbTriangles-1; // k is a constant
		}
		scene.nbLightTriangles += 2;
		scene.nbLights += 2;
	}
}

void addSphere(vec3 position, float radius, Material material, inout Scene scene){
	if (scene.nbSpheres + 1 > MAXSPHERES)
	{
		return;
	}
	for (int k = 0; k < MAXSPHERES; ++k)
		if(k == scene.nbSpheres)
			scene.spheres[k] = Sphere(position, radius, radius*radius, material); // k is a constant
	
	scene.nbSpheres++;

	if(isEmissive(material) && scene.nbLightSpheres + 1 <= MAXLIGHTS){
		for (int k = 0; k < MAXLIGHTS; ++k)
			if(k == scene.nbLightSpheres)
				scene.light_spheres[k] = scene.nbSpheres-1;
		scene.nbLightSpheres++;
		scene.nbLights++;
	}
}

void addCornell(vec3 position, float scale, in Material mground, in Material mfront, in Material mleft, in Material mright,in Material mup, inout Scene scene) {
	// ground
	addQuad(position + scale * vec3(0.0,0,-0.5), scale * vec2(1.0), vec3(0,1,0), 0.0, mground, scene);
	// front
	addQuad(position + scale * vec3(0.5,0,0), scale * vec2(1.0), vec3(0,1,0), HALF_PI, mfront, scene);
	// left
	addQuad(position + scale * vec3(0,0.5,0), scale * vec2(1.0), vec3(1,0,0), HALF_PI, mleft, scene);
	// right
	addQuad(position + scale * vec3(0,-0.5,0), scale * vec2(1.0), vec3(1,0,0), -HALF_PI, mright, scene);
	// up
	addQuad(position + scale * vec3(0,0,0.5), scale * vec2(1.0), vec3(0,1,0), 0.0, mup, scene);
}

void addCornell(vec3 position, float scale, in Material mat, inout Scene scene) {
	addCornell(position, scale, mat, mat, mat, mat, mat, scene);
}

void addCube(vec3 position, float scale, in Material mat, inout Scene scene){
	addQuad(position + scale * vec3(0.0,0,-0.5), scale * vec2(1.0), vec3(0,1,0), 0.0, mat, scene);
	addQuad(position + scale * vec3(0.5,0,0), scale * vec2(1.0), vec3(0,1,0), HALF_PI, mat, scene);
	addQuad(position + scale * vec3(0,0.5,0), scale * vec2(1.0), vec3(1,0,0), HALF_PI, mat, scene);
	addQuad(position + scale * vec3(0,-0.5,0), scale * vec2(1.0), vec3(1,0,0), -HALF_PI, mat, scene);
	addQuad(position + scale * vec3(0,0,0.5), scale * vec2(1.0), vec3(0,1,0), 0.0, mat, scene);
	addQuad(position + scale * vec3(-0.5,0,0), scale * vec2(1.0), vec3(0,1,0), HALF_PI, mat, scene);
}

void addTetrahedron(vec3 position, vec3 scale, vec3 axis, float angle, in Material material, inout Scene scene){
	if (scene.nbTriangles + 4 > MAXTRIANGLES)
	{
		return;
	}
	mat3 R = rotationMatrix(axis, angle);
	vec3 a = R * vec3(0) + position;
	vec3 b = R * vec3(0, scale.y, 0) + position;
	vec3 c = R * vec3(scale.x, 0, 0) + position;
	vec3 top = R * vec3(0, 0, scale.z) + position;

	for (int k = 0; k < MAXTRIANGLES; ++k)
		if(k == scene.nbTriangles)
			scene.triangles[k] = Triangle(a, b, c, material);
		else if(k == scene.nbTriangles+1)
			scene.triangles[k] = Triangle(a, b, top, material);
		else if(k == scene.nbTriangles+2)
			scene.triangles[k] = Triangle(a, c, top, material);
		else if(k == scene.nbTriangles+3)
			scene.triangles[k] = Triangle(b, c, top, material);

	if (isEmissive(material) && scene.nbLightTriangles + 4 <= MAXLIGHTS)
	{
		for (int k = 0; k < MAXLIGHTS; ++k)
			if(k == scene.nbTriangles)
				scene.light_triangles[k] = scene.nbTriangles;
			else if(k == scene.nbTriangles+1)
				scene.light_triangles[k] = scene.nbTriangles+1;
			else if(k == scene.nbTriangles+2)
				scene.light_triangles[k] = scene.nbTriangles+2;
			else if(k == scene.nbTriangles+3)
				scene.light_triangles[k] = scene.nbTriangles+3;

		scene.nbLightTriangles += 4;
		scene.nbLights += 4;
	}
	scene.nbTriangles += 4;
}

void initSceneCornell(inout Scene scene, inout vec3 position, vec3 delta_p, inout vec2 rotation, vec2 delta_r){
	// Camera
	rotation += delta_r;
	vec3 front = sphericalToCartesian(rotation);
	vec3 right = normalize(cross(UP, front));

	position += front * delta_p.x;
	position += right * delta_p.y;
	position.z += delta_p.z;

	vec2 cplane = vec2(canvas.x,canvas.y) / ((canvas.x+canvas.y)/2.0);
	scene.camera = makeCameraFromFrontRight(position, front, right, cplane);

	Material diffuse_white = Material(vec3(1), vec3(0), 0.0, 0, 0.0);
	Material diffuse_red = Material(vec3(1,0,0), vec3(0), 0.0, 0, 0.0);
	Material diffuse_green = Material(vec3(0,1,0), vec3(0), 0.0, 0, 0.0);

	// Cornell
	vec3 center = INITIAL_POS_SPP.xyz + scene_scale * vec3(20,0,-1.8);
	addCornell(center, scene_scale * 5.0, diffuse_white, diffuse_white, diffuse_red, diffuse_green, diffuse_white, scene);
	float factor = 0.3;

	// Lights
	//Material mlight1 = Material(vec3(0), vec3(0, 0.25, 1) / factor, 0.0, 0, 0.0);
	Material mlight1 = Material(vec3(0), vec3(10) / factor, 0.0, 0, 0.0);
	addSphere(center + scene_scale * vec3(0, 0, 2), scene_scale * factor, mlight1, scene); // BLUE

	//Material mlight2 = Material(vec3(0), vec3(1, 1, 0) / factor, 0.0, 0, 0.0);
	Material mlight2 = Material(vec3(0), vec3(1) / factor, 0.0, 0, 0.0);
	//addSphere(center + scene_scale * vec3(-1, -1.5, -1.75), scene_scale * 2.0 * factor, mlight2, scene); // YELLOW

	//Material mlight3 = Material(vec3(0), vec3(1, 0, 0.25) / factor, 0.0, 0, 0.0);
	Material mlight3 = Material(vec3(0), vec3(1) / factor, 0.0, 0, 0.0);
	//addSphere(center + scene_scale * vec3(0, 0, 0), scene_scale * 2.0 * factor, mlight3, scene); // PINK

	//Material mlight4 = Material(vec3(0), vec3(0, 0.97, 0.1) / factor, 0.0, 0, 0.0);
	Material mlight4 = Material(vec3(0), vec3(1) / factor, 0.0, 0, 0.0);
	//addCube(center + scene_scale * vec3(2, -2, 0), scene_scale * 1.5 * factor, mlight4, scene); // GREEN

	// Cubes
	addCube(center + scene_scale * vec3(-1,1.5,-1.5), scene_scale, Material(vec3(1), vec3(0), 0.0, 2, 1.52), scene); // Adds fresnel cube

	// Spheres
	Material msdiffp = Material(vec3(1), vec3(0), 0.0, 2, 1.52);
	addSphere(center + scene_scale * vec3(1,-1,-1), scene_scale * factor * 3.0, msdiffp, scene);

	Material msdiffy = Material(vec3(1,1,0), vec3(0), 0.0, 0, 0.0);
	addSphere(center + scene_scale * vec3(1,-3,2), scene_scale * factor * 7.0, msdiffy, scene);

	Material msgloss1 = Material(vec3(0.3,0.9,0.9), vec3(0), 10.0, 0, 0.0);
	addSphere(center + scene_scale * vec3(1,2,-1), scene_scale * factor * 5.0, msgloss1, scene);

	Material msspec1 = Material(vec3(1.0,0.5,0.3), vec3(0), 1000.0, 0, 0.0);
	addSphere(center + scene_scale * vec3(0,0,-8), scene_scale * factor * 20.0, msspec1, scene);

	Material msspec2 = Material(vec3(1.0,1.0,1.0), vec3(0), 50000.0, 1, 0.0);
	addSphere(center + scene_scale * vec3(5,5,5), scene_scale * factor * 20.0, msspec2, scene);

	Material msgloss2 = Material(vec3(1.0,0.0,0.7), vec3(0), 1.0, 0, 0.0);
	addSphere(center + scene_scale * vec3(2,0,0.5), scene_scale * factor * 3.0, msgloss2, scene);
}

void initSceneRefract(inout Scene scene, inout vec3 position, vec3 delta_p, inout vec2 rotation, vec2 delta_r, bool all_white){
	// Camera
	rotation += delta_r;
	vec3 front = sphericalToCartesian(rotation);
	vec3 right = normalize(cross(UP, front));

	position += front * delta_p.x;
	position += right * delta_p.y;
	position.z += delta_p.z;

	vec2 cplane = vec2(canvas.x,canvas.y) / ((canvas.x+canvas.y)/2.0);
	scene.camera = makeCameraFromFrontRight(position, front, right, cplane);

	Material diffuse_white = Material(vec3(1), vec3(0), 0.0, 0, 0.0);
	Material diffuse_red = Material(vec3(1,0,0), vec3(0), 0.0, 0, 0.0);
	Material diffuse_green = Material(vec3(0,1,0), vec3(0), 0.0, 0, 0.0);

	if(all_white)
	{
		diffuse_red = diffuse_white;
		diffuse_green = diffuse_white;
	}

	// Cornell
	vec3 center = INITIAL_POS_SPP.xyz + scene_scale * vec3(20,0,-1.8);
	addCornell(center, scene_scale * 5.0, diffuse_white, diffuse_white, diffuse_red, diffuse_green, diffuse_white, scene);
	float factor = 0.3;

	// Lights
	Material mlight1 = Material(vec3(0), vec3(1) / factor * 1.0, 0.0, 0, 0.0);
	// Material mlight1 = Material(vec3(0), vec3(100) / factor, 0.0, 0, 0.0);
	addSphere(center + scene_scale * vec3(0,0,3), scene_scale * factor * 5.0, mlight1, scene); // WHITE
	// addQuad(center + scene_scale * vec3(0,0,2), scene_scale * factor * vec2(1.0) * 10.0, vec3(0,1,0), 0.0, mlight1, scene); // WHITE

	float eta0 = 1.000293; // Air
	float eta1 = 1.33; // Water
	float eta2 = 1.52; // Glass
	float eta3 = 2.417; // Diamond
	float eta4 = 3.45; // Silicon
	// Objects
	if (!all_white)
	{
		addSphere(center + scene_scale * vec3(2,2,0.5), scene_scale * factor * 1.5, Material(vec3(1,0,0), vec3(0), 0.0, 0, 0.0), scene);
		addSphere(center + scene_scale * vec3(2,1,0.5), scene_scale * factor * 1.5, Material(vec3(0.75,0.25,0), vec3(0), 0.0, 0, 0.0), scene);
		addSphere(center + scene_scale * vec3(2,0,0.5), scene_scale * factor * 1.5, Material(vec3(0.5,0.5,0), vec3(0), 0.0, 0, 0.0), scene);
		addSphere(center + scene_scale * vec3(2,-1,0.5), scene_scale * factor * 1.5, Material(vec3(0.25,0.75,0), vec3(0), 0.0, 0, 0.0), scene);
		addSphere(center + scene_scale * vec3(2,-2,0.5), scene_scale * factor * 1.5, Material(vec3(0,1,0), vec3(0), 0.0, 0, 0.0), scene);

		addSphere(center + scene_scale * vec3(2,2,-2), scene_scale * factor * 1.5, Material(vec3(1,0,0), vec3(0), 0.0, 0, 0.0), scene);
		addSphere(center + scene_scale * vec3(2,1,-2), scene_scale * factor * 1.5, Material(vec3(0.75,0.25,0), vec3(0), 0.0, 0, 0.0), scene);
		addSphere(center + scene_scale * vec3(2,0,-2), scene_scale * factor * 1.5, Material(vec3(0.5,0.5,0), vec3(0), 0.0, 0, 0.0), scene);
		addSphere(center + scene_scale * vec3(2,-1,-2), scene_scale * factor * 1.5, Material(vec3(0.25,0.75,0), vec3(0), 0.0, 0, 0.0), scene);
		addSphere(center + scene_scale * vec3(2,-2,-2), scene_scale * factor * 1.5, Material(vec3(0,1,0), vec3(0), 0.0, 0, 0.0), scene);
	}

	addSphere(center + scene_scale * vec3(0,2,0), scene_scale * factor * 1.5, Material(vec3(1), vec3(0), 0.0, 2, eta0), scene);
	addSphere(center + scene_scale * vec3(0,1,0), scene_scale * factor * 1.5, Material(vec3(1), vec3(0), 0.0, 2, eta1), scene);
	addSphere(center + scene_scale * vec3(0,0,0), scene_scale * factor * 1.5, Material(vec3(1), vec3(0), 0.0, 2, eta2), scene);
	addSphere(center + scene_scale * vec3(0,-1,0), scene_scale * factor * 1.5, Material(vec3(1), vec3(0), 0.0, 2, eta3), scene);
	addSphere(center + scene_scale * vec3(0,-2,0), scene_scale * factor * 1.5, Material(vec3(1), vec3(0), 0.0, 2, eta4), scene);

	addCube(center + scene_scale * vec3(0,2,-1), scene_scale * 0.75, Material(vec3(1), vec3(0), 0.0, 2, eta0), scene);
	addCube(center + scene_scale * vec3(0,1,-1), scene_scale * 0.75, Material(vec3(1), vec3(0), 0.0, 2, eta1), scene);
	addCube(center + scene_scale * vec3(0,0,-2), scene_scale * 0.75, Material(vec3(1), vec3(0), 0.0, 2, eta2), scene);
	addCube(center + scene_scale * vec3(0,-1,-1), scene_scale * 0.75, Material(vec3(1), vec3(0), 0.0, 2, eta3), scene);
	addCube(center + scene_scale * vec3(0,-2,-1), scene_scale * 0.75, Material(vec3(1), vec3(0), 0.0, 2, eta4), scene);

	addTetrahedron(center + scene_scale * vec3(0,0,-2), vec3(scene_scale * 0.75) * 2.0, vec3(0,0,1), 135.0, Material(vec3(1), vec3(0), 0.0, 2, eta2), scene);
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

vec3 sample_cosine(in Intersection inter, inout float pdf) {
	highp float phi = rand1() * 2.0 * PI;
	highp float theta = acos(sqrt(1.0 - rand1()));
	float sintheta = sin(theta);
	float costheta = cos(theta);
	vec3 sampled = vec3(sintheta * cos(phi), sintheta * sin(phi), costheta);

	if(!sameHemisphere(inter.normal, sampled))
		sampled *= -1.0;
	pdf = costheta / PI;
	return sampled;
}

vec3 sample_mirror(in Intersection inter, inout float pdf) {
	vec3 sampled = reflection(-normalize(inter.ray.direction), inter.normal);

	if(!sameHemisphere(inter.normal, sampled))
		sampled *= -1.0;
	pdf = 1.0;
	return sampled;
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

vec3 sample_fresnel(in Intersection inter, inout float pdf) {
	vec3 sampled;
	float cost = dot(-inter.ray.direction, inter.normal);
	float eta1 = inter.ray.eta, eta2 = inter.material.eta;

	bool entering = cost > 0.0; // does not work for triangles that are not oriented correctly
	//bool entering = eta1 != eta2; // more robust in many case but imperfect

	if(!entering) {
		swap(eta1,eta2);
		//eta2 = 1.0; // going outside of material (suppose that no surfaces directly touches another one)
	}

	float fresnel_term = FrDielectric(cost, eta1, eta2);
	pdf = 1.0;

	if(rand1() > fresnel_term){
		float eta = eta1/eta2;
		float sin2ThetaI = max(0.0, 1.0 - cost * cost);
		float sin2ThetaT = eta * eta * sin2ThetaI;
		// Handle total internal reflection for transmission
		if (sin2ThetaT >= 1.0) return vec3(0);
		float cosThetaT = sqrt(1.0 - sin2ThetaT);
		sampled = eta * -(-inter.ray.direction) + (eta * cost - cosThetaT) * inter.normal;

		pdf *= 1.0 / (1.0 - fresnel_term);
	}
	else {
		pdf *= 1.0 / fresnel_term;
		float void_pdf;
		return sample_mirror(inter, void_pdf);
	}

	return normalize(sampled);
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

void sample_BSDF(in Intersection inter, inout DirectionSample ds, inout vec3 beta_modifier){
	vec3 old_dir_world = normalize(-inter.ray.direction);
	vec2 old_dir_world_spherical = cartesianToSpherical(old_dir_world);

	vec3 old_dir_local = worldToLocal(inter.normal, old_dir_world);
	vec2 old_dir_local_spherical = cartesianToSpherical(old_dir_local);

	vec3 new_dir_local;

	if(inter.material.bsdf_number == 0)
		new_dir_local = sample_cosine(inter, ds.pdf);
	else if(inter.material.bsdf_number == 1)
		new_dir_local = sample_mirror(inter, ds.pdf);
	else if(inter.material.bsdf_number == 2)
	{
		// Spectral dispersion
		if(true)
		{
			float picked_rnd = rand1();
			float wvl_selection = picked_rnd * (750.0-350.0) + 350.0;
			//int wvl_selection = int(floor(rand1() * 3.0));

			if (inter.material.eta == 1.52 || inter.ray.eta == 1.52)
			{
				// GLASS
				float new_eta = 1.52;
				float old_eta = inter.material.eta;


				// if (wvl_selection == 0)
				// {
				// 	new_eta = 1.5145; // 650nm
				// 	//new_eta = 1.01; // 650nm
				// 	beta_modifier = vec3(1, 0, 0);
				// }
				// if (wvl_selection == 1)
				// {
				// 	new_eta = 1.5208; // 510nm
				// 	//new_eta = 50.0; // 510nm
				// 	beta_modifier = vec3(0, 1, 0);
				// }
				// if (wvl_selection == 2)
				// {
				// 	new_eta = 1.5228; // 480nm
				// 	//new_eta = 100.0; // 480nm
				// 	beta_modifier = vec3(0, 0, 1);
				// }
				//
				// beta_modifier = beta_modifier*3.0;

				// if (wvl_selection <= 483.333)
				// {
				// 	beta_modifier = vec3(1, 0, 0);
				// }
				// if (wvl_selection > 483.333 && wvl_selection < 666.666)
				// {
				// 	beta_modifier = vec3(0, 1, 0);
				// }
				// if (wvl_selection >= 666.666)
				// {
				// 	beta_modifier = vec3(0, 0, 1);
				// }

				beta_modifier = wvl_to_rgb(wvl_selection);

				// new_eta = picked_rnd * 0.5 + 1.0;
				//new_eta = picked_rnd * (1.5228 - 1.5145) + 1.5145;
				new_eta = picked_rnd * (3.4 - 1.5) + 1.5;
				// beta_modifier = beta_modifier*(750.0-350.0);

				// new_eta = picked_rnd * (4.0 - 1.5) + 1.5;
				// new_eta = picked_rnd * (old_eta * 2.0 - old_eta - 0.5) + old_eta - 0.5;

				if (inter.material.eta == 1.52)
				{
					inter.material.eta = new_eta;
				}
				else
				{
					inter.ray.eta = new_eta;
				}
			}
		}
		new_dir_local = sample_fresnel(inter, ds.pdf);
	}

	vec3 new_dir_world = localToWorld(new_dir_local);
	// new_dir_world = new_dir_local;

	ds.direction = new_dir_world;
	ds.bsdf = BSDF(inter.material, old_dir_local_spherical, cartesianToSpherical(new_dir_local));
}

void sample_BSDF_without_world_recalibration(in Intersection inter, inout DirectionSample ds){
	vec3 old_dir = normalize(-inter.ray.direction);
	vec2 old_dir_spherical = cartesianToSpherical(old_dir);
	vec3 new_dir;
	if(inter.material.bsdf_number == 0)
		new_dir = sample_cosine(inter, ds.pdf);
	else if(inter.material.bsdf_number == 1)
		new_dir = sample_mirror(inter, ds.pdf);
	else if(inter.material.bsdf_number == 2)
		new_dir = sample_fresnel(inter, ds.pdf);

	ds.direction = new_dir;
	ds.bsdf = BSDF(inter.material, old_dir_spherical, cartesianToSpherical(new_dir));
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
	float sinthetamax = sphere.radius /d;

	// float thetamax = asin(sinthetamax);
	float costhetamax = sqrt(1.0 - sinthetamax * sinthetamax);//cos(thetamax);

	highp float costheta = 1.0 - rand1()  * (1.0 - costhetamax);

	float sintheta = sqrt(1.0 - costheta * costheta);//sin(acos(costheta))
	highp float phi = rand1() * TWO_PI;

	// D = 1 - d² sin² θ / r²
	float sintheta2 =  sintheta * sintheta;
	float D = 1.0 - d2 * sintheta2 / sphere.radius2;
	bool D_positive = D > 0.0;

	float cosalpha = float(D_positive) * (sintheta2 / sinthetamax + costheta * sqrt(abs(D)))
					+ float(!D_positive) * sinthetamax;

	float sinalpha = sin(acos(cosalpha));//sqrt(1.0 - cosalpha * cosalpha);

	vec3 direction = vec3(sinalpha * cos(phi), sinalpha * sin(phi), cosalpha);
	if(abs(main_direction.z) > 0.99999){
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

vec3 computeIllumination(in Scene scene, in Intersection inter, in SurfaceLightSample sls, in vec3 Le, in bool from_area_to_SA) {
	float pdf_light = sls.pdf / float(scene.nbLightSpheres); // dividing because using sampleOneLight
	vec3 pointToSample = sls.point - inter.point;
	pointToSample = normalize(pointToSample);

	float bsdf = BSDF(inter.material, cartesianToSpherical(-inter.ray.direction), cartesianToSpherical(pointToSample));
	float cosi = abs(dot(inter.normal, pointToSample));
	vec3 prod = bsdf * cosi * inter.material.albedo; // bounce toward light prod, called f in pbrt

	if (isNan(prod[0]) || isNan(prod[1]) || isNan(prod[2])) prod = vec3(0); // Sub optimal fix

	if(!isBlack(prod)) {
		Ray ray_light = Ray(inter.point + pointToSample * epsilon, pointToSample, 1.0); // Better correlates with naive
		// Ray ray_light = Ray(inter.point + inter.normal * epsilon, pointToSample, 1.0); // Ray origin is shifted along normal instead of pointToSample

		if(from_area_to_SA) {
			float dist = length(pointToSample);
			float cosl = abs(dot(sls.normal, -normalize(pointToSample)));
			float SA_to_area = (dist*dist) / cosl;
			pdf_light *= SA_to_area;
		}

		float V = float(visibility(ray_light, scene, sls.point));
		vec3 Li = V * Le;

		vec3 color_current_light =  Li * prod;
		return color_current_light;
	}
}

vec3 sampleAllLights(in Scene scene, in Intersection inter){
	vec3 Li_all;
	SurfaceLightSample sls;

	// Sample light spheres
	for (int k = 0; k < MAXSPHERES; ++k)
		if(k <= scene.nbLightSpheres) {
			for (int l = 0; l < MAXSPHERES; ++l)
				if(l == scene.light_spheres[k]) {
					sampleSphereSA(inter.point, scene.spheres[l], sls); // pdf in Solid Angle
					vec3 Le = scene.spheres[l].material.emissive;
					Li_all += computeIllumination(scene, inter, sls, Le, false);
				}
		}

	// Sample light triangles
	for (int k = 0; k < MAXTRIANGLES; ++k)
		if(k <= scene.nbLightTriangles) {
			for (int l = 0; l < MAXTRIANGLES; ++l)
				if(l == scene.light_triangles[k]) {
					sampleTriangleArea(inter.point, scene.triangles[l], sls); // pdf in Area converted to SA
					vec3 Le = scene.triangles[l].material.emissive;
					Li_all += computeIllumination(scene, inter, sls, Le, true);
				}
		}

	// return Li_all / float(scene.nbLights);
	return Li_all;
}

vec3 sampleOneLight(in Scene scene, in Intersection inter){
	vec3 Li_all;
	SurfaceLightSample sls;

	int i = int(rand1() * float(scene.nbLights));
	if(i < scene.nbLightSpheres) {
		for (int k = 0; k < MAXSPHERES; ++k)
			if(k == i) {
				sampleSphereSA(inter.point, scene.spheres[k], sls); // pdf in Solid Angle
				vec3 Le = scene.spheres[k].material.emissive;
				Li_all += computeIllumination(scene, inter, sls, Le, false);
			}
	} else {
		for (int k = 0; k < MAXTRIANGLES; ++k)
			if(k == i) {
				sampleTriangleArea(inter.point, scene.triangles[k], sls); // pdf in Area converted to SA
				vec3 Le = scene.triangles[k].material.emissive;
				Li_all += computeIllumination(scene, inter, sls, Le, true);
			}
	}
	return Li_all;
	// return Li_all / float(scene.nbLights);
	// return Li_all * float(scene.nbLights);
}

vec3 traceNormals(in Ray ray, in Scene scene, bool xray) {
	vec3 res = vec3(0);
	vec3 color_total;
	if(u_iterations <= 0) {
		Intersection inter;
		inter = inter_dummy(ray);
		for(float depth = 1.0; depth < 5.0; ++depth) {
			raySceneIntersection(ray, scene, inter);
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

vec3 traceRay(in Ray ray, in Scene scene, bool shadow) {
	vec3 res = vec3(0);
	vec3 color_total;
	if(u_iterations <= PATHS_NB) {
		Intersection inter;
		inter = inter_dummy(ray);
		if(raySceneIntersection(ray, scene, inter)) {
			if(!isBlack(inter.material.emissive)) {
				color_total += inter.material.emissive;
			} else {
				// Shadowed ?
				if(!shadow){
					color_total += dot(-ray.direction, inter.normal) * inter.material.albedo;
				}
				else
				{
					color_total += sampleAllLights(scene, inter);
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

vec3 tracePath(in Ray ray, in Scene scene, bool naive, bool lastLight) {
	// res is pixel color
	// color_total is computed color (needs to be scaled based on u_iterations)
	// beta is propagating color
	vec3 res, color_total, beta = vec3(1);
	bool spec_last = false; // last bounce was specular ?
	bool spec_current = false;
	DirectionSample ds;
	ds.pdf = 1.0;

	if(u_iterations <= PATHS_NB) {
		Intersection inter;

		for(int depth = 0; depth < MAX_DEPTH; ++depth) {
			inter = inter_dummy(ray); // needed to init hit to false
			if(raySceneIntersection(ray, scene, inter)) {
				spec_current = inter.material.bsdf_number == 1 || inter.material.bsdf_number == 2;
				// Emissive material
				if(isEmissive(inter.material)) {
					if(depth == 0 || naive || spec_last) {
						color_total += beta * inter.material.emissive; // lights do not have albedo // TODO: study different kind of lights
					} else if(lastLight && depth < MAX_DEPTH-1) {
						color_total += beta * inter.material.emissive;
					}
				} else if(!spec_current) {
					// Light sampling
					if(!naive) { // Iterative PT
						// color_total += beta * sampleAllLights(scene, inter);
						if(!lastLight || lastLight && depth == MAX_DEPTH-1) {
							color_total += beta * sampleOneLight(scene, inter);
						}
					}
				}

				// Surface sampling for next bounce
				vec3 beta_modifier = vec3(1);
				sample_BSDF(inter, ds, beta_modifier);
				// sample_BSDF_without_world_recalibration(inter, ds);
				spec_last = spec_current;
				ray = Ray(inter.point + ds.direction*epsilon, ds.direction, inter.material.eta);

				float acost = abs(dot(ds.direction, inter.normal));

				beta *= acost * inter.material.albedo * beta_modifier; // beta propagates cosine, albedo and bsdf value through the path
				if(!spec_last)
					beta *= ds.bsdf / ds.pdf;
				if(ds.pdf <= 0.0 || beta == vec3(0)) break; // No prod (skymap or light touched) or no prob (opposite hemisphere sampling)
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

Scene scene;

void main() {
	vec3 delta_p = vec3(11,0,0);
		delta_p.x += keyboard.x;
		delta_p.y += keyboard.y;
		delta_p.z += keyboard.z;
	vec2 delta_r = vec2(0);
		delta_r.x += mouse.x * rotation_speed;
		delta_r.y += mouse.y * rotation_speed;
	vec4 pos_spp = INITIAL_POS_SPP; //(memorized location)
	vec4 rot_tech = INITIAL_ROT_TECH;
	vec2 rot_tech_xy = rot_tech.xy;
	vec2 uv_swap = v_uv;
	uv_swap.x = -v_uv.x + 1.0;

	//initSceneCornell(scene, pos_spp.xyz, delta_p, rot_tech_xy, delta_r);
	initSceneRefract(scene, pos_spp.xyz, delta_p, rot_tech_xy, delta_r, false);
	//if(u_scene == 0)
	//	initSceneCornell(scene, pos_spp.xyz, delta_p, rot_tech_xy, delta_r);
	//else
	//	initSceneCornell(scene, pos_spp.xyz, delta_p, rot_tech_xy, delta_r);

	vec3 color;

	for(int i = 1 ; i <= SPPPF; ++i) // Make SPPPF samples per pixel per frame
	{
		if(u_random_mode == 0)
			seed = u_time * sin(u_time) + (gl_FragCoord.x + canvas.x * gl_FragCoord.y) / canvas.y;
		else if(u_random_mode == 1)
			seed = u_time;
		else if(u_random_mode == 2)
			seed = u_time + (gl_FragCoord.x * gl_FragCoord.y);
		else if(u_random_mode == 3)
			seed = u_time;

		Ray ray = makeRay(uv_swap, scene.camera);
		vec3 tmp;
		if (u_render_mode == -1)
			tmp = traceNormals(ray, scene, false); // Normals
		else if (u_render_mode == 0)
			tmp = traceRay(ray, scene, false); // Raytracing
		else if (u_render_mode == 1)
			tmp = traceRay(ray, scene, true); // Raytracing shadowed
		else if (u_render_mode == 2)
			tmp = tracePath(ray, scene, true, false); // Path tracing naive
		else if (u_render_mode == 3)
			tmp = tracePath(ray, scene, false, true); // Path tracing last (sample light on last vertex)
		else if (u_render_mode == 4)
			tmp = tracePath(ray, scene, false, false); // Path tracing iterative (sample light on all vertices)
		if(isColor(tmp))
			color += tmp;
	}

	color /= float(SPPPF);
	gl_FragColor = vec4(color, 1.0);
}`;

window.onload = runGL;

"use strict";

let gl;
let canvas;
let message;

let shaderProgram;
let angleX = 0;
let angleY = 0;
let u_keyboard = [0, 0, 0];

//Texture
let textures;
let objattrtex;

//Vertex Shader
let VertexLocation;

//Fragment Shader
let u_numsLocation;
let u_lightsLocation;
let u_timeLocation;
let u_itrLocation;
let u_render_modeLocation;
let u_random_modeLocation;
let u_sceneLocation;
let u_textureLocation;
let u_attrtextureLocation;
let u_texsizeLocation;
let u_attrtexsizeLocation;
let u_texLocations = [];
let u_mouseLocation;
let u_keyboardLocation;

// Added for attrtexture
// Width and height must be pow(2,n)
let attw = 1024; // width
let atth = 2; // height
let attributes = new Uint8Array(attw * atth * 4);

// Render shader
let renderProgram;
let renderVertexAttribute;
let vertexPositionBuffer;
let frameBuffer;
let u_textureLocationc;

let u_time = 0;
let u_iterations = 0;
let u_render_mode = 4;
let u_random_mode = 0;
let u_scene = 0;

let Datas = [];
let DefaultDatas = [];

///////////////////////////////////////////////////////////////////////////

function runGL() {
	let begin = Date.now();
	initGL();
	let end = Date.now();
	document.getElementById("time").innerHTML += "Initialize WebGL: " + (end - begin).toString() + " ms<br/>";

	begin = end;
	initializeShader();
	initBuffers();

	end = Date.now();
	document.getElementById("time").innerHTML += "Initialize Shader: " + (end - begin).toString() + " ms<br/>";

	initDefaultScene();

	animate();

	//register
	canvas.onmousedown = handleMouseDown;
	// canvas.oncontextmenu = function (ev) { return false; };
	document.onmouseup = handleMouseUp;
	document.onmousemove = handleMouseMove;
	document.onkeydown = handleKeyDown;
}

///////////////////////////////////////////////////////////////////////////

function initGL() {
	message = document.getElementById("message");
	canvas = document.getElementById("canvas");
	gl = createWebGLContext(canvas, message);

	if (!gl) {
		alert("Could not initialise WebGL, sorry :-(");
		return;
	}
	gl.viewport(0, 0, canvas.width, canvas.height);
	gl.clearColor(0.0, 0.0, 0.0, 1.0);
	gl.enable(gl.DEPTH_TEST);
}

function initBuffers() {
	vertexPositionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
	const vertices = [
		1.0, 1.0,
		-1.0, 1.0,
		1.0, -1.0,
		-1.0, -1.0,
	];

	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
	gl.vertexAttribPointer(VertexLocation, 2, gl.FLOAT, false, 0, 0);

	frameBuffer = gl.createFramebuffer();
	const type = gl.getExtension('OES_texture_float') ? gl.FLOAT : gl.UNSIGNED_BYTE;

	textures = [];
	for (let i = 0; i < 2; i++) {
		textures.push(gl.createTexture());
		gl.bindTexture(gl.TEXTURE_2D, textures[i]);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, canvas.width, canvas.height, 0, gl.RGB, type, null);
	}
	gl.bindTexture(gl.TEXTURE_2D, null);

	objattrtex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, objattrtex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.bindTexture(gl.TEXTURE_2D, null);
}

function initializeShader() {
	// Create render shader
	const renderVs = window.shaders.vs_render;
	const renderFs = window.shaders.fs_render;

	renderProgram = createProgram(gl, renderVs, renderFs, message);
	renderVertexAttribute = gl.getAttribLocation(renderProgram, 'i_vertex');
	gl.enableVertexAttribArray(renderVertexAttribute);

	u_textureLocationc = gl.getUniformLocation(renderProgram, "u_texture");

	// Create path tracer shader
	const vs = window.shaders.vs_pathTracer;
	const fs = window.shaders.fs_pathTracer;

	shaderProgram = createProgram(gl, vs, fs, message);

	// Vertex Shader
	VertexLocation = gl.getAttribLocation(shaderProgram, "i_vertex");
	gl.enableVertexAttribArray(VertexLocation);

	// Fragment Shader
	u_timeLocation = gl.getUniformLocation(shaderProgram, "u_time");
	u_itrLocation = gl.getUniformLocation(shaderProgram, "u_iterations");
	u_numsLocation = gl.getUniformLocation(shaderProgram, "u_objnums");
	u_lightsLocation = gl.getUniformLocation(shaderProgram, "u_lights");
	u_render_modeLocation = gl.getUniformLocation(shaderProgram, "u_render_mode");
	u_random_modeLocation = gl.getUniformLocation(shaderProgram, "u_random_mode");
	u_sceneLocation = gl.getUniformLocation(shaderProgram, "u_scene");

	u_textureLocation = gl.getUniformLocation(shaderProgram, "u_texture");
	u_attrtextureLocation = gl.getUniformLocation(shaderProgram, "u_attrtexture");
	u_texsizeLocation = gl.getUniformLocation(shaderProgram, "u_texsize");
	u_attrtexsizeLocation = gl.getUniformLocation(shaderProgram, "u_attrtexsize");

	// Move
	u_mouseLocation = gl.getUniformLocation(shaderProgram, "u_mouse");
	u_keyboardLocation = gl.getUniformLocation(shaderProgram, "u_keyboard");
}

function animate() {

	message.innerHTML = "Iterations: " + (u_iterations).toString();

	if (!pause || u_iterations === 0) {
		///////////////////////////////////////////////////////////////////////////
		// Render
		gl.useProgram(shaderProgram);

		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		gl.uniform1f(u_timeLocation, u_time);
		gl.uniform1i(u_itrLocation, u_iterations);
		gl.uniform1i(u_numsLocation, Datas.length);
		let numlights = 0;
		for (let i = 0; i < Datas.length; i++)
			if (Datas[i].obj_emissive[0] != 0.0 && Datas[i].obj_emissive[1] != 0.0 && Datas[i].obj_emissive[2] != 0.0)
				numlights++;
		gl.uniform1i(u_lightsLocation, numlights);
		gl.uniform1i(u_render_modeLocation, u_render_mode);
		gl.uniform1i(u_random_modeLocation, u_random_mode);
		gl.uniform1i(u_sceneLocation, u_scene);

		// Added for texture size
		gl.uniform2f(u_texsizeLocation, canvas.width, canvas.height);
		gl.uniform2f(u_attrtexsizeLocation, attw, atth);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, textures[0]);
		gl.uniform1i(u_textureLocation, 0);

		gl.activeTexture(gl.TEXTURE1); // Attributes for objects
		gl.bindTexture(gl.TEXTURE_2D, objattrtex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, attw, atth, 0, gl.RGB, gl.UNSIGNED_BYTE, attributes);
		gl.uniform1i(u_attrtextureLocation, 1);

		// Move
		gl.uniform2f(u_mouseLocation, angleX, angleY);
		gl.uniform3f(u_keyboardLocation, u_keyboard[0], u_keyboard[1], u_keyboard[2]);

		gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
		gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[1], 0);
		gl.vertexAttribPointer(VertexLocation, 2, gl.FLOAT, false, 0, 0);

		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		textures.reverse();

		gl.useProgram(renderProgram);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, textures[0]);
		gl.uniform1i(u_textureLocationc, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
		gl.vertexAttribPointer(renderVertexAttribute, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		u_iterations++;
		u_time += 1.0;
	}
	window.requestAnimFrame(animate);
}

function AddObjsAttr(i) {
	gl.useProgram(shaderProgram);
	// objtype:[0.0,1.0] to [0,255]
	attributes[21 * i + 0] = 255.0 * Datas[i].obj_type;
	// texturetype:[0.0,5.0] to [0,255]
	attributes[21 * i + 1] = 255.0 * Datas[i].obj_textureType / 5.0;
	// bsdf_number: [0.0, 3.0] to[0, 255]
	attributes[21 * i + 2] = 255.0 * Datas[i].obj_bsdf_number / 3.0;
	// vertices:[-100.0,100.0] to [0,255] times 3
	const mind = -100.0;
	const maxd = 100.0;
	attributes[21 * i + 3] = 255.0 * (Datas[i].obj_v1[0] - mind) / (maxd - mind);
	attributes[21 * i + 4] = 255.0 * (Datas[i].obj_v1[1] - mind) / (maxd - mind);
	attributes[21 * i + 5] = 255.0 * (Datas[i].obj_v1[2] - mind) / (maxd - mind);
	attributes[21 * i + 6] = 255.0 * (Datas[i].obj_v2[0] - mind) / (maxd - mind);
	attributes[21 * i + 7] = 255.0 * (Datas[i].obj_v2[1] - mind) / (maxd - mind);
	attributes[21 * i + 8] = 255.0 * (Datas[i].obj_v2[2] - mind) / (maxd - mind);
	attributes[21 * i + 9] = 255.0 * (Datas[i].obj_v3[0] - mind) / (maxd - mind);
	attributes[21 * i + 10] = 255.0 * (Datas[i].obj_v3[1] - mind) / (maxd - mind);
	attributes[21 * i + 11] = 255.0 * (Datas[i].obj_v3[2] - mind) / (maxd - mind);

	// Albedo
	attributes[21 * i + 12] = 255.0 * Datas[i].obj_albedo[0];
	attributes[21 * i + 13] = 255.0 * Datas[i].obj_albedo[1];
	attributes[21 * i + 14] = 255.0 * Datas[i].obj_albedo[2];

	// Emissive
	attributes[21 * i + 15] = 255.0 * Datas[i].obj_emissive[0] / 10.0;
	attributes[21 * i + 16] = 255.0 * Datas[i].obj_emissive[1] / 10.0;
	attributes[21 * i + 17] = 255.0 * Datas[i].obj_emissive[2] / 10.0;

	// Eta and Shininess
	attributes[21 * i + 18] = 255.0 * Datas[i].obj_eta / 10.0;
	attributes[21 * i + 19] = 255.0 * Datas[i].obj_shininess;
	attributes[21 * i + 20] = 255.0;
}

function addSphere() {
	if (Datas.length == 63)
		return;
	Datas.push({
		obj_type: 0,
		obj_textureType: 0,
		obj_v1: [Math.random() * 100.0 - 50.0, Math.random() * 100.0 - 50.0, Math.random() * 100.0 - 50.0],
		obj_v2: [0.0, 0.0, 0.0],
		obj_v3: [0.0, 0.0, 0.0],
		obj_bsdf_number: Math.random() * 3.0,
		obj_albedo: [Math.random(), Math.random(), Math.random()],
		obj_emissive: [Math.random(), Math.random(), Math.random()],
		obj_eta: Math.random() * 10.0,
		obj_shininess: Math.random(),
	});

	AddObjsAttr(Datas.length - 1);

	u_iterations = 0;
}

function addTriangle() {
	if (Datas.length == 63)
		return;
	Datas.push({
		obj_type: 1,
		obj_textureType: 0,
		obj_v1: [Math.random() * 200.0 - 50.0, Math.random() * 200.0 - 50.0, Math.random() * 200.0 - 50.0],
		obj_v2: [Math.random() * 200.0 - 50.0, Math.random() * 200.0 - 50.0, Math.random() * 200.0 - 50.0],
		obj_v3: [Math.random() * 200.0 - 50.0, Math.random() * 200.0 - 50.0, Math.random() * 200.0 - 50.0],
		obj_bsdf_number: Math.random() * 3.0,
		obj_albedo: [Math.random(), Math.random(), Math.random()],
		obj_emissive: [Math.random(), Math.random(), Math.random()],
		obj_eta: Math.random() * 10.0,
		obj_shininess: Math.random(),
	});

	AddObjsAttr(Datas.length - 1);

	u_iterations = 0;
}

function rotationMatrix(axis, angle) {
	const ratio = Math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2);
	axis[0] = axis[0] / ratio;
	axis[1] = axis[1] / ratio;
	axis[2] = axis[2] / ratio;
	s = Math.sin(angle / 180 * Math.PI);
	c = Math.cos(angle / 180 * Math.PI);
	oc = 1.0 - c;
	return glMatrix.mat3.fromValues(oc * axis[0] * axis[0] + c, oc * axis[0] * axis[1] - axis[2] * s, oc * axis[2] * axis[0] + axis[1] * s,
		oc * axis[0] * axis[1] + axis[2] * s, oc * axis[1] * axis[1] + c, oc * axis[1] * axis[2] - axis[0] * s,
		oc * axis[2] * axis[0] - axis[1] * s, oc * axis[1] * axis[2] + axis[0] * s, oc * axis[2] * axis[2] + c);
}

function addQuad(datas, position, scale = glMatrix.vec2.fromValues(1, 1), axis = glMatrix.vec3.fromValues(0, 0, 1), angle = 0, obj_bsdf_number = 0, obj_albedo = glMatrix.vec3.fromValues(1, 1, 1), obj_emissive = glMatrix.vec3.fromValues(0, 0, 0), obj_eta = 1.5, obj_shininess = 0) {
	if (datas.length == 31)
		return;

	R = rotationMatrix(axis, angle);

	fl = glMatrix.vec3.create();
	glMatrix.vec3.transformMat3(fl, glMatrix.vec3.fromValues(-0.5 * scale[0], -0.5 * scale[1], 0), R);
	glMatrix.vec3.add(fl, fl, position);
	fr = glMatrix.vec3.create();
	glMatrix.vec3.transformMat3(fr, glMatrix.vec3.fromValues(-0.5 * scale[0], 0.5 * scale[1], 0), R);
	glMatrix.vec3.add(fr, fr, position);
	bl = glMatrix.vec3.create();
	glMatrix.vec3.transformMat3(bl, glMatrix.vec3.fromValues(0.5 * scale[0], -0.5 * scale[1], 0), R);
	glMatrix.vec3.add(bl, bl, position);
	br = glMatrix.vec3.create();
	glMatrix.vec3.transformMat3(br, glMatrix.vec3.fromValues(0.5 * scale[0], 0.5 * scale[1], 0), R);
	glMatrix.vec3.add(br, br, position);
	datas.push({
		obj_type: 1,
		obj_textureType: 0,
		obj_v1: fl,
		obj_v2: fr,
		obj_v3: br,
		obj_bsdf_number: obj_bsdf_number,
		obj_albedo: obj_albedo,
		obj_emissive: obj_emissive,
		obj_eta: obj_eta,
		obj_shininess: obj_shininess
	});

	datas.push({
		obj_type: 1,
		obj_textureType: 0,
		obj_v1: br,
		obj_v2: bl,
		obj_v3: fl,
		obj_bsdf_number: obj_bsdf_number,
		obj_albedo: obj_albedo,
		obj_emissive: obj_emissive,
		obj_eta: obj_eta,
		obj_shininess: obj_shininess
	});

	u_iterations = 0;
}

function initDefaultScene() {
	// Light
	// DefaultDatas.push({
	// 	obj_type: 0,
	// 	obj_textureType: 0,
	// 	obj_v1: [0, 0, 10],
	// 	obj_v2: [6, 0, 0],
	// 	obj_v3: [0, 0, 0],
	// 	obj_bsdf_number: 0,
	// 	obj_albedo: [0, 0, 0],
	// 	obj_emissive: [0.5, 0.5, 0.5],
	// 	obj_eta: 0.0,
	// 	obj_shininess: 0,
	// });

	DefaultDatas.push({
		obj_type: 0,
		obj_textureType: 0,
		obj_v1: [5, 5, 4],
		obj_v2: [(4 - 50) * 2, 0, 0],
		obj_v3: [0, 0, 0],
		obj_bsdf_number: 0,
		obj_albedo: [1, 1, 1],
		obj_emissive: [1, 0.8, 0.8],
		obj_eta: 1.0,
		obj_shininess: 0,
	});

	DefaultDatas.push({
		obj_type: 0,
		obj_textureType: 0,
		obj_v1: [5, 0, 4],
		obj_v2: [(4 - 50) * 2, 0, 0],
		obj_v3: [0, 0, 0],
		obj_bsdf_number: 0,
		obj_albedo: [1, 1, 1],
		obj_emissive: [0.8, 1, 0.8],
		obj_eta: 1.0,
		obj_shininess: 0,
	});

	DefaultDatas.push({
		obj_type: 0,
		obj_textureType: 0,
		obj_v1: [5, -5, 4],
		obj_v2: [(4 - 50) * 2, 0, 0],
		obj_v3: [0, 0, 0],
		obj_bsdf_number: 0,
		obj_albedo: [1, 1, 1],
		obj_emissive: [0.8, 0.8, 1],
		obj_eta: 1.0,
		obj_shininess: 0,
	});

	// Objects
	// Mirror
	DefaultDatas.push({
		obj_type: 0,
		obj_textureType: 0,
		obj_v1: [5, 5, -5],
		obj_v2: [(8 - 50) * 2, 0, 0],
		obj_v3: [0, 0, 0],
		obj_bsdf_number: 1,
		obj_albedo: [1, 1, 1],
		obj_emissive: [0, 0, 0],
		obj_eta: 1.0,
		obj_shininess: 1,
	});

	eta0 = 1.000293; // Air
	eta1 = 1.33; // Water
	eta2 = 1.52; // Glass
	eta3 = 2.417; // Diamond
	eta4 = 3.45; // Silicon
	// eta4 = 10.0;

	s = 2;
	h = 1.5;
	DefaultDatas.push({
		obj_type: 0,
		obj_textureType: 0,
		obj_v1: [0, 5, h],
		obj_v2: [(s - 50) * 2, 0, 0],
		obj_v3: [0, 0, 0],
		obj_bsdf_number: 2,
		obj_albedo: [1, 1, 1],
		obj_emissive: [0, 0, 0],
		obj_eta: eta0,
		obj_shininess: 1,
	});

	DefaultDatas.push({
		obj_type: 0,
		obj_textureType: 0,
		obj_v1: [0, 2.5, h],
		obj_v2: [(s - 50) * 2, 0, 0],
		obj_v3: [0, 0, 0],
		obj_bsdf_number: 2,
		obj_albedo: [1, 1, 1],
		obj_emissive: [0, 0, 0],
		obj_eta: eta1,
		obj_shininess: 1,
	});

	DefaultDatas.push({
		obj_type: 0,
		obj_textureType: 0,
		obj_v1: [0, 0, h],
		obj_v2: [(s - 50) * 2, 0, 0],
		obj_v3: [0, 0, 0],
		obj_bsdf_number: 2,
		obj_albedo: [1, 1, 1],
		obj_emissive: [0, 0, 0],
		obj_eta: eta2,
		obj_shininess: 1,
	});

	DefaultDatas.push({
		obj_type: 0,
		obj_textureType: 0,
		obj_v1: [0, -2.5, h],
		obj_v2: [(s - 50) * 2, 0, 0],
		obj_v3: [0, 0, 0],
		obj_bsdf_number: 2,
		obj_albedo: [1, 1, 1],
		obj_emissive: [0, 0, 0],
		obj_eta: eta3,
		obj_shininess: 1,
	});

	DefaultDatas.push({
		obj_type: 0,
		obj_textureType: 0,
		obj_v1: [0, -5, h],
		obj_v2: [(s - 50) * 2, 0, 0],
		obj_v3: [0, 0, 0],
		obj_bsdf_number: 2,
		obj_albedo: [1, 1, 1],
		obj_emissive: [0, 0, 0],
		obj_eta: eta4,
		obj_shininess: 1,
	});



	// Cornell
	const size = 10;
	const height = 5;

	addQuad(
		/* datas */ DefaultDatas,
		/* position */ glMatrix.vec3.fromValues(0, 0, -height),
		/* scale */ glMatrix.vec2.fromValues(size, size),
		/* axis */ glMatrix.vec3.fromValues(0, 0, 1),
		/* angle */ 0,
		/* obj_bsdf_number */ 0,
		/* obj_albedo */ glMatrix.vec3.fromValues(1, 1, 1),
		/* obj_emissive */ glMatrix.vec3.fromValues(0, 0, 0),
		/* obj_eta */ 1.0,
		/* obj_shininess */ 0
	);
	addQuad(
		/* datas */ DefaultDatas,
		/* position */ glMatrix.vec3.fromValues(0, 0, height),
		/* scale */ glMatrix.vec2.fromValues(size, size),
		/* axis */ glMatrix.vec3.fromValues(0, 0, 1),
		/* angle */ 0,
		/* obj_bsdf_number */ 0,
		/* obj_albedo */ glMatrix.vec3.fromValues(1, 1, 1),
		/* obj_emissive */ glMatrix.vec3.fromValues(0, 0, 0),
		/* obj_eta */ 1.0,
		/* obj_shininess */ 0
	);
	addQuad(
		/* datas */ DefaultDatas,
		/* position */ glMatrix.vec3.fromValues(0, -size / 2, 0),
		/* scale */ glMatrix.vec2.fromValues(size, size),
		/* axis */ glMatrix.vec3.fromValues(1, 0, 0),
		/* angle */ 90,
		/* obj_bsdf_number */ 0,
		/* obj_albedo */ glMatrix.vec3.fromValues(1, 0.25, 0.25),
		/* obj_emissive */ glMatrix.vec3.fromValues(0, 0, 0),
		/* obj_eta */ 1.0,
		/* obj_shininess */ 0
	);
	addQuad(
		/* datas */ DefaultDatas,
		/* position */ glMatrix.vec3.fromValues(0, size / 2, 0),
		/* scale */ glMatrix.vec2.fromValues(size, size),
		/* axis */ glMatrix.vec3.fromValues(1, 0, 0),
		/* angle */ 90,
		/* obj_bsdf_number */ 0,
		/* obj_albedo */ glMatrix.vec3.fromValues(0.25, 1, 0.25),
		/* obj_emissive */ glMatrix.vec3.fromValues(0, 0, 0),
		/* obj_eta */ 1.0,
		/* obj_shininess */ 0
	);
	addQuad(
		/* datas */ DefaultDatas,
		/* position */ glMatrix.vec3.fromValues(size / 2, 0, 0),
		/* scale */ glMatrix.vec2.fromValues(size, size),
		/* axis */ glMatrix.vec3.fromValues(0, 1, 0),
		/* angle */ 90,
		/* obj_bsdf_number */ 0,
		/* obj_albedo */ glMatrix.vec3.fromValues(1, 1, 1),
		/* obj_emissive */ glMatrix.vec3.fromValues(0, 0, 0),
		/* obj_eta */ 1.0,
		/* obj_shininess */ 0
	);

	defaultScene();
}

function defaultScene() {
	Datas.length = 0;

	for (let i = 0; i < DefaultDatas.length; i++) {
		Datas[i] = DefaultDatas[i];
		AddObjsAttr(i);
	}

	u_iterations = 0;
}

function resize(width, height) {
	canvas.width = width;
	canvas.height = height;

	gl.viewport(0, 0, canvas.width, canvas.height);

	const type = gl.getExtension('OES_texture_float') ? gl.FLOAT : gl.UNSIGNED_BYTE;

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, textures[0]);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, canvas.width, canvas.height, 0, gl.RGB, type, null);

	gl.bindTexture(gl.TEXTURE_2D, textures[1]);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, canvas.width, canvas.height, 0, gl.RGB, type, null);

	gl.bindTexture(gl.TEXTURE_2D, null);

	u_iterations = 0;
}

// INTERACTION

let mouseLeftDown = false;
let mouseRightDown = false;
let mouseMidDown = false;
let lastMouseX = null;
let lastMouseY = null;

let pause = false;

function handleMouseDown(event) {
	if (event.button === 2) {
		mouseLeftDown = false;
		mouseRightDown = true;
		mouseMidDown = false;
		return;
	}
	else if (event.button === 0) {
		mouseLeftDown = true;
		mouseRightDown = false;
		mouseMidDown = false;
	}
	else if (event.button === 1) {
		mouseLeftDown = false;
		mouseRightDown = false;
		mouseMidDown = true;
	}
	lastMouseX = event.clientX;
	lastMouseY = event.clientY;
}

function handleMouseUp(event) {
	mouseLeftDown = false;
	mouseRightDown = false;
	mouseMidDown = false;
}

function handleMouseMove(event) {
	if (!(mouseLeftDown || mouseRightDown || mouseMidDown)) {
		return;
	}
	if (mouseRightDown) return;
	const newX = event.clientX;
	const newY = event.clientY;

	const deltaX = newX - lastMouseX;
	const deltaY = newY - lastMouseY;

	if (mouseLeftDown) {
		// update the angles based on how far we moved since last time
		angleY -= deltaX * 0.01;
		angleX += deltaY * 0.01;

		// don't go upside down
		// angleX = Math.max(angleX, -Math.PI / 2 + 0.01);
		// angleX = Math.min(angleX, Math.PI / 2 - 0.01);
	}
	else if (mouseRightDown) {
	}
	else if (mouseMidDown) {
	}
	// console.log(angleX, angleY);
	lastMouseX = newX;
	lastMouseY = newY;

	u_iterations = 0;
}

function handleKeyDown(event) {
	if (event.code == "Space")
		pause = !pause;
	if (event.code == "KeyA") {
		++u_keyboard[1];
		u_iterations = 0;
	}
	if (event.code == "KeyD") {
		--u_keyboard[1];
		u_iterations = 0;
	}
	if (event.code == "KeyW") {
		++u_keyboard[0];
		u_iterations = 0;
	}
	if (event.code == "KeyS") {
		--u_keyboard[0];
		u_iterations = 0;
	}
	if (event.code == "ShiftLeft" || event.code == "ShiftRight") {
		--u_keyboard[2];
		u_iterations = 0;
	}
	if (event.code == "ControlLeft" || event.code == "ControlRight") {
		++u_keyboard[2];
		u_iterations = 0;
	}
}

function change_render_mode(i) {
	u_iterations = 0;
	u_render_mode = i;
	console.log("Changed render_mode to: " + u_render_mode);
}

function change_random_mode(i) {
	u_iterations = 0;
	u_random_mode = i;
	console.log("Changed random_mode to: " + u_random_mode);
}

function change_scene(i) {
	u_iterations = 0;
	u_scene = i;
	console.log("Changed scene to: " + u_scene);
}

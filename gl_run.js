window.onload = runGL;

"use strict";

var gl;
var canvas;
var message;

var shaderProgram;
var angleX = 0;
var angleY = 0;
var keyboard = [0,0,0];

//Texture
var textures;

//Vertex Shader
var VertexLocation;

//Fragment Shader
var u_timeLocation;
var u_itrLocation;
var u_render_modeLocation;
var u_random_modeLocation;
var u_sceneLocation;
var u_textureLocation;
var u_texsizeLocation;
var u_texLocations = [];
var u_mouseLocation;
var u_keyboardLocation;

//render shader
var renderProgram;
var renderVertexAttribute;
var vertexPositionBuffer;
var frameBuffer;
var u_textureLocationc;

var u_time = 0;
var u_iterations = 0;
var u_render_mode = 2;
var u_random_mode = 0;
var u_scene = 0;

///////////////////////////////////////////////////////////////////////////

function runGL() {
	var begin = Date.now();
	initGL();
	var end = Date.now();
	document.getElementById("time").innerHTML +=  "Initialize WebGL: " + (end-begin).toString() + " ms<br/>";
	
	begin = end;
	initializeShader();
	initBuffers();
	
	end = Date.now();
	document.getElementById("time").innerHTML +=  "Initialize Shader: " + (end-begin).toString() + " ms<br/>";

	animate();
	
	//register
	canvas.onmousedown = handleMouseDown;
	// canvas.oncontextmenu = function (ev) { return false; };
	document.onmouseup = handleMouseUp;
	document.onmousemove = handleMouseMove;
	document.onkeydown = handleKeyDown;
}

///////////////////////////////////////////////////////////////////////////

function initGL(){
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
	var vertices = [
	 1.0, 1.0,
	-1.0, 1.0,
	 1.0, -1.0,
	-1.0, -1.0,
	];

	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
	gl.vertexAttribPointer(VertexLocation, 2, gl.FLOAT, false, 0, 0);

	frameBuffer = gl.createFramebuffer();
	var type = gl.getExtension('OES_texture_float') ? gl.FLOAT : gl.UNSIGNED_BYTE;

	textures = [];
	for (var i = 0; i < 2; i++) {
		textures.push(gl.createTexture());
		gl.bindTexture(gl.TEXTURE_2D, textures[i]);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, canvas.width, canvas.height, 0, gl.RGB, type, null);
	}
	gl.bindTexture(gl.TEXTURE_2D, null);
}

function initializeShader() {
	//create render shader
	var renderVs = getShaderSource(document.getElementById("vs_render"));
	var renderFs = getShaderSource(document.getElementById("fs_render"));

	renderProgram = createProgram(gl, renderVs, renderFs, message);
	renderVertexAttribute = gl.getAttribLocation(renderProgram, 'i_vertex');
	gl.enableVertexAttribArray(renderVertexAttribute);

	u_textureLocationc = gl.getUniformLocation(renderProgram, "u_texture");

	// Create path tracer shader
	var vs = getShaderSource(document.getElementById("vs_pathTracer"));
	var fs = getShaderSource(document.getElementById("fs_pathTracer"));

	shaderProgram = createProgram(gl, vs, fs, message);

	// Vertex Shader
	VertexLocation = gl.getAttribLocation(shaderProgram, "i_vertex");
	gl.enableVertexAttribArray(VertexLocation);

	// Fragment Shader        
	u_timeLocation = gl.getUniformLocation(shaderProgram, "u_time");
	u_itrLocation = gl.getUniformLocation(shaderProgram, "u_iterations");
	u_render_modeLocation = gl.getUniformLocation(shaderProgram, "u_render_mode");
	u_random_modeLocation = gl.getUniformLocation(shaderProgram, "u_random_mode");
	u_sceneLocation = gl.getUniformLocation(shaderProgram, "u_scene");

	u_textureLocation = gl.getUniformLocation(shaderProgram, "u_texture");
	u_texsizeLocation = gl.getUniformLocation(shaderProgram, "u_texsize");

	// Move
	u_mouseLocation = gl.getUniformLocation(shaderProgram, "mouse");
	u_keyboardLocation = gl.getUniformLocation(shaderProgram, "keyboard");

}

function animate() {
	
	message.innerHTML = "Iterations: " + (u_iterations).toString();

	if (!pause || u_iterations == 0) {
		///////////////////////////////////////////////////////////////////////////
		// Render
		gl.useProgram(shaderProgram);

		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	
		gl.uniform1f(u_timeLocation, u_time);
		gl.uniform1i(u_itrLocation, u_iterations);
		gl.uniform1i(u_render_modeLocation, u_render_mode);
		gl.uniform1i(u_random_modeLocation, u_random_mode);
		gl.uniform1i(u_sceneLocation, u_scene);

		//Added for texture size
		gl.uniform2f(u_texsizeLocation, canvas.width,canvas.height);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, textures[0]);
		gl.uniform1i(u_textureLocation, 0);

		// Move 
		gl.uniform2f(u_mouseLocation, angleX, angleY);
		gl.uniform3f(u_keyboardLocation, keyboard[0], keyboard[1], keyboard[2]);

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

function resize() {
	canvas.width = width;
	canvas.height = height;
	
	gl.viewport(0, 0, canvas.width, canvas.height);
	
	var type = gl.getExtension('OES_texture_float') ? gl.FLOAT : gl.UNSIGNED_BYTE;

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, textures[0]);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, canvas.width, canvas.height, 0, gl.RGB, type, null);
	
	gl.bindTexture(gl.TEXTURE_2D, null);
	
	iterations = 0;
}

// INTERACTION

var mouseLeftDown = false;
var mouseRightDown = false;
var mouseMidDown = false;
var lastMouseX = null;
var lastMouseY = null;

var pause = false;

function handleMouseDown(event) {
	if (event.button == 2) {
		mouseLeftDown = false;
		mouseRightDown = true;
		mouseMidDown = false;
		return;
	}
	else if (event.button == 0) {
		mouseLeftDown = true;
		mouseRightDown = false;
		mouseMidDown = false;
	}
	else if (event.button == 1) {
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
	if(mouseRightDown) return;
	var newX = event.clientX;
	var newY = event.clientY;

	var deltaX = newX - lastMouseX;
	var deltaY = newY - lastMouseY;

	if (mouseLeftDown) {
		// update the angles based on how far we moved since last time
		angleY -= deltaX * 0.01;
		angleX += deltaY * 0.01;

		// don't go upside down
		angleX = Math.max(angleX, -Math.PI / 2 + 0.01);
		angleX = Math.min(angleX, Math.PI / 2 - 0.01);
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
		++keyboard[1];
		u_iterations = 0;
	}
	if (event.code == "KeyD") {
		--keyboard[1];
		u_iterations = 0;
	}
	if (event.code == "KeyW") {
		++keyboard[0];
		u_iterations = 0;
	}
	if (event.code == "KeyS") {
		--keyboard[0];
		u_iterations = 0;
	}
	if (event.code == "ShiftLeft" || event.code == "ShiftRight") {
		--keyboard[2];
		u_iterations = 0;
	}
	if (event.code == "ControlLeft" || event.code == "ControlRight") {
		++keyboard[2];
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

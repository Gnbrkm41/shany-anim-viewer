var lastFrameTime = Date.now() / 1000;
var canvas;
var shader;
var batcher;
var WebGL;
const mvp = new spine.webgl.Matrix4();
var assetManager;
var skeletonRenderer;
var shapes;

let pathJSON = null;
let pathAtlas = null;
let pathTexture = null;

let asset = null;

let assetType = "cb";
let assetID = "0000010010";

let assetInfo = {};
let isRecording = false;
let frameRate = 30;

let recordFrames = [];
let completePromiseHandler;
const dataURL = ".";

let sdConfigs = {
    "width": 0,
    "height": 0,
    "offsetX": 0,
    "offsetY": 0,
}
let exportQuality = 90

const $ = document.querySelectorAll.bind(document);

async function Init() {
    canvas = $("canvas")[0];
    canvas.width = 900 //window.innerWidth;
    canvas.height = 1200 //window.innerHeight;

    const config = { alpha: true };
    WebGL =
        canvas.getContext("webgl", config) ||
        canvas.getContext("experimental-webgl", config);
    if (!WebGL) {
        alert("WebGL을 사용할 수 없는 환경입니다.");
        return;
    }
    
    WebGL.pixelStorei(WebGL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);        

    mvp.ortho2d(0, 0, canvas.width - 1, canvas.height - 1);

    // Create a simple shader, mesh, model-view-projection matrix and SkeletonRenderer.
    skeletonRenderer = new spine.webgl.SkeletonRenderer(WebGL, false);
    assetManager = new spine.webgl.AssetManager(WebGL);
    batcher = new spine.webgl.PolygonBatcher(WebGL, false);
    shapes = new spine.webgl.ShapeRenderer(WebGL);
    shader = spine.webgl.Shader.newColoredTextured(WebGL);

    // 애셋 불러오기
    assetInfo = (await axios.get(dataURL + "/asset.json")).data;

    // 애셋 데이터 가공
    for (let key in assetInfo) {
        assetInfo[key] = assetInfo[key].map((id) => {
            const idArray = id.split("").map((item) => {
                return parseInt(item);
            });
            return {
                value: id,
                type: idArray.shift(),
                special_type: idArray.shift(),
                rarity: idArray.shift(),
                idol_id: parseInt(idArray.splice(0, 3).join("")),
                release_id: parseInt(idArray.splice(0, 3).join("")),
                other: idArray.shift()
            };
        });
    }

    // 배경 색상 선택기
    const colorPicker = document.querySelector("#color-picker");
    colorPicker.onchange = (event) => {
        document.body.style.backgroundColor = event.target.value;
    };
    
    LoadAsset();
}

function HexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? result.slice(1, 4).map((item) => {
              return parseInt(item, 16) / 255;
          })
        : null;
}

function DropHandler(event) {
    // Prevent default behavior (Prevent file from being opened)
    event.preventDefault();

    if (event.dataTransfer.items) {
        for (let item of event.dataTransfer.items) {
            if (item.kind === "file") {
                const file = item.getAsFile();
                const blobURL = window.URL.createObjectURL(file);
                if (file.name.endsWith(".atlas")) {
                    pathAtlas = blobURL;
                } else if (file.name.endsWith(".png")) {
                    pathTexture = blobURL;
                } else if (file.name.endsWith(".json")) {
                    pathJSON = blobURL;
                } else if (file.name.endsWith(".webp")) {
                    pathTexture = blobURL;
                }
            }
        }
    } else {
        for (let file of event.dataTransfer.files) {
            const blobURL = window.URL.createObjectURL(file);
            if (file.name.endsWith(".atlas")) {
                pathAtlas = blobURL;
            } else if (file.name.endsWith(".png")) {
                pathTexture = blobURL;
            } else if (file.name.endsWith(".json")) {
                pathJSON = blobURL;
            } else if (file.name.endsWith(".webp")) {
                pathTexture = blobURL;
            }
        }
    }

    if (pathAtlas && pathTexture && pathJSON) {
        requestAnimationFrame(LoadAsset);
    } else {
        const loadedFiles = [
            pathAtlas ? "Atlas" : null,
            pathTexture ? "이미지" : null,
            pathJSON ? "JSON" : null
        ]
            .filter((item) => item)
            .join(", ");

        alert(
            "3개의 파일 (data.json, data.atlas, data.png) 을 한꺼번에 드롭해주세요.\n현재 불러온 파일: " +
                loadedFiles
        );
        ClearDragStatus();
    }
}

function ClearDragStatus() {
    pathJSON = null;
    pathAtlas = null;
    pathTexture = null;
}

function DragOverHandler(event) {
    // Prevent default behavior (Prevent file from being opened)
    event.preventDefault();
}

function LoadAsset() {
    // Tell AssetManager to load the resources for each model, including the exported .json file, the .atlas file and the .png
    // file for the atlas. We then wait until all resources are loaded in the load() method.

    // 현재 파일을 null로 설정하여 렌더링 중단
    asset = null;

    // 메모리 관리를 위한 unload 작업
    assetManager.removeAll();

    const path = [dataURL, "assets", assetType, assetID, "data"].join("/");
    assetManager.loadText(pathJSON || path + ".json");
    assetManager.loadText(pathAtlas || path + ".atlas");
    assetManager.loadTexture(pathTexture || path + ".png");
    requestAnimationFrame(Load);
}

async function LoadAssetAndStartRecording() {
    // Stop rendering.
    asset = null;
    assetManager.removeAll();

    const path = [dataURL, "assets", assetType, assetID, "data"].join("/");
    assetManager.loadText(pathJSON || path + ".json");
    assetManager.loadText(pathAtlas || path + ".atlas");
    assetManager.loadTexture(pathTexture || path + ".png");

    isRecording = true;
    recordFrames = [];
    requestAnimationFrame(Load);

    let promise = new Promise((success) => completePromiseHandler = success);
    return promise;
}

function Load() {
    // Wait until the AssetManager has loaded all resources, then load the skeletons.
    if (assetManager.isLoadingComplete()) {
        asset = LoadSpine(isRecording ? ($("#animationList")[0].value ?? "wait") : "", true);
        if (!isRecording) {
            SetupAnimationList();
            SetupSkinList();
        }
        requestAnimationFrame(Render);
    } else {
        requestAnimationFrame(Load);
    }
}

function LoadSpine(initialAnimation, premultipliedAlpha) {
    // Load the texture atlas using name.atlas and name.png from the AssetManager.
    // The function passed to TextureAtlas is used to resolve relative paths.
    const fileArray = [dataURL, "assets", assetType, assetID, "data"];
    const filePath = fileArray.join("/");
    const subPath = fileArray.slice(0, 4).join("/");

    atlas = new spine.TextureAtlas(
        assetManager.get(pathAtlas || filePath + ".atlas"),
        (path) => {
            return assetManager.get(pathTexture || [subPath, path].join("/"));
        }
    );

    // Create a AtlasAttachmentLoader that resolves region, mesh, boundingbox and path attachments
    atlasLoader = new spine.AtlasAttachmentLoader(atlas);

    // Create a SkeletonJson instance for parsing the .json file.
    const skeletonJson = new spine.SkeletonJson(atlasLoader);

    // Set the scale to apply during parsing, parse the file, and create a new skeleton.
    const skeletonData = skeletonJson.readSkeletonData(assetManager.get(pathJSON || filePath + ".json"));
    const skeleton = new spine.Skeleton(skeletonData);
    try {
        skeleton.setSkinByName("normal"); // SD 일러스트 기본 스킨
    } catch (e) {}

    // Create an AnimationState, and set the initial animation in looping mode.
    animationStateData = new spine.AnimationStateData(skeleton.data);
    animationStateData.defaultMix = 0.3; // 애니메이션 사이를 부드럽게 전환. 값을 높일수록 느리게 전환됨
    const animationState = new spine.AnimationState(animationStateData);
    animationState.multipleMixing = true; // 여러 애니메이션의 믹싱을 활성화.

    // animationStateData.setMix("wait", "ok", 0.4);
    // animationStateData.setMix("jump", "run", 0.4);
    // animationState.setAnimation(0, "walk", true);
    // var jumpEntry = animationState.addAnimation(0, "jump", false, 3);
    // animationState.addAnimation(0, "run", true, 0);

    if (initialAnimation !== "") {
        try {
            animationState.setAnimation(0, initialAnimation, !isRecording);
        } catch (e) {
            animationState.setAnimation(0, "talk_wait", !isRecording); // 하즈키 SD 관련 수정
        }
    }


    if (debug) {
        animationState.addListener({
            start: function (track) {
                console.log("Animation on track " + track.trackIndex + " started");
            },
            interrupt: function (track) {
                console.log("Animation on track " + track.trackIndex + " interrupted");
            },
            end: function (track) {
                console.log("Animation on track " + track.trackIndex + " ended");
            },
            disposed: function (track) {
                console.log("Animation on track " + track.trackIndex + " disposed");
            },
            complete: function (track) {
                console.log("Animation on track " + track.trackIndex + " completed");
            },
            event: function (track, event) {
                console.log(
                    "Event on track " + track.trackIndex + ": " + JSON.stringify(event)
                );
            }
        });
    }

    // Pack everything up and return to caller.
    return {
        skeleton: skeleton,
        state: animationState,
        stateData: animationStateData,
        bounds: CalculateBounds(skeleton),
        premultipliedAlpha: premultipliedAlpha
    };
}

let debug = false;

function CalculateBounds(skeleton) {
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform();
    var offset = new spine.Vector2();
    var size = new spine.Vector2();
    skeleton.getBounds(offset, size, []);
    return { offset: offset, size: size };
}


function SetupAnimationList() {
    const animationList = $("#animationList")[0];
    const skeleton = asset.skeleton;
    const state = asset.state;
    const activeAnimation = state.tracks[0] ? state.tracks[0].animation.name : "";

    animationList.innerHTML = "";

    for (let animation of skeleton.data.animations) {
        const name = animation.name;
        const option = document.createElement("option");
        option.textContent = name;
        option.value = name;
        option.selected = name === activeAnimation;
        animationList.appendChild(option);
    }
    // animationList.size = $("#animationList option").length;

    animationList.onchange = () => {
        const state = asset.state;
        const skeleton = asset.skeleton;
        const animationName = animationList.value;
        if (!animationName) return;

        skeleton.setToSetupPose();

        let trackIndex = 0;
        let isLoop = true;

        if (animationName.startsWith("eye")) {
            trackIndex = 1;
        } else if (animationName.startsWith("face")) {
            trackIndex = 2;
        } else if (animationName.startsWith("lip")) {
            trackIndex = 3;
        } else if (animationName.startsWith("arm")) {
            isLoop = false;
        } else if (animationName == "on" || animationName == "off") {
            trackIndex = 4;
        }

        state.setAnimation(trackIndex, animationName, isLoop);
    };
}

function ClearTrack() {
    if (asset) {
        for (let i = 1; i < 5; i++) {
            asset.state.clearTrack(i);
            asset.state.setEmptyAnimation(i);
        }
    }
}

function SetupSkinList() {
    const skinList = $("#skinList")[0];
    const skeleton = asset.skeleton;
    const activeSkin = skeleton.skin == null ? "default" : skeleton.skin.name;

    skinList.innerHTML = "";

    for (let skin of skeleton.data.skins) {
        const name = skin.name;
        const option = document.createElement("option");
        option.textContent = name;
        option.value = name;
        option.selected = name === activeSkin;
        skinList.appendChild(option);
    }
    skinList.size = $("#skinList option").length;

    skinList.onchange = () => {
        const skeleton = asset.skeleton;
        const skinName = skinList.value;
        skeleton.setSkinByName(skinName);
        skeleton.setSlotsToSetupPose();
    };
}

function Render() {
    var now = Date.now() / 1000;
    var delta = isRecording ? 1.0 / frameRate : now - lastFrameTime;
    lastFrameTime = now;

    // 배경 그리기
    WebGL.clearColor(0, 0, 0, 0);
    WebGL.clear(WebGL.COLOR_BUFFER_BIT);

    // 애셋이 없으면 여기서 마무리
    if (asset === null) {
        return;
    }

    // Update the MVP matrix to adjust for canvas size changes
    Resize();

    // Apply the animation state based on the delta time.
    var state = asset.state;
    var skeleton = asset.skeleton;
    var premultipliedAlpha = asset.premultipliedAlpha;
    state.update(delta);
    state.apply(skeleton);
    skeleton.updateWorldTransform();

    // Bind the shader and set the texture and model-view-projection matrix.
    shader.bind();
    shader.setUniformi(spine.webgl.Shader.SAMPLER, 0);
    shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, mvp.values);

    // Start the batch and tell the SkeletonRenderer to render the active skeleton.
    batcher.begin(shader);
    skeletonRenderer.premultipliedAlpha = premultipliedAlpha;
    skeletonRenderer.draw(batcher, skeleton);
    batcher.end();
    shader.unbind();

    if (isRecording) {       
        canvas.toBlob((blob) => recordFrames.push(blob), "image/webp", exportQuality)

        if (state.tracks[0].isComplete()) {
            isRecording = false;
            completePromiseHandler && completePromiseHandler()
        }
    }
    requestAnimationFrame(Render);
}

function Resize() {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    var bounds = asset.bounds;
    /*if (canvas.width != w || canvas.height != h) {
        canvas.width = w;
        canvas.height = h;
    }*/

    let isSd = bounds.size.x < 400 && bounds.size.y < 600;
    if (isSd) {
        canvas.width = 300 + sdConfigs.width
        canvas.height = 450 + sdConfigs.height
    } else {
        canvas.width = bounds.size.x + 40 + sdConfigs.width
        canvas.height = bounds.size.y + 40 + sdConfigs.height
    }
    
    // magic
    var centerX = bounds.offset.x + bounds.size.x / 2;
    var centerY = bounds.offset.y + bounds.size.y / 2;

    centerY += sdConfigs.offsetY
    centerX += sdConfigs.offsetX

    var scaleX = bounds.size.x / canvas.width;
    var scaleY = bounds.size.y / canvas.height;
    var scale = isSd ? Math.max(scaleX, scaleY) * 1.2 : 1;
    var width = canvas.width * scale;
    var height = canvas.height * scale;

    mvp.ortho2d(centerX - width / 2, centerY - height / 2, width, height);
    WebGL.viewport(0, 0, canvas.width, canvas.height);
}

let spines = {}
let directoryHandle;
async function SelectDirectory() {
    directoryHandle = await window.showDirectoryPicker({ id: "spineViewer-open", mode: "readwrite" });
    spines = {};
    for await (const [name, handle] of directoryHandle.entries()) {
        if (handle.kind === "directory") {
            var json = null, atlas = null, spriteSheet = null;
            for await ([fileName, fileHandle] of handle.entries()) {
                if (fileName.endsWith("png") || fileName.endsWith("webp")) {
                    spriteSheet = fileHandle
                }
                else if (fileName.endsWith("json")) {
                    json = fileHandle
                }
                else if (fileName.endsWith("atlas")) {
                    atlas = fileHandle
                }
            }
            if (!(json === null || atlas === null || spriteSheet === null)) {
                spines[name] = {"texture": spriteSheet, "json": json, "atlas": atlas}
            }
        }
    }

    SetupIdolList()
}

function SetupIdolList() {
    const idolList = $("#idolList")[0];
    idolList.disabled = false

    idolList.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Please select";
    defaultOption.disabled = true;
    defaultOption.selected = true;
    idolList.appendChild(defaultOption);

    for (const key of Object.keys(spines)) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = key;
        idolList.appendChild(option);
    }

    idolList.onchange = async () => {
        selected = spines[idolList.selectedOptions[0].textContent]

        if (selected === undefined) {
            return;
        }

        pathAtlas = window.URL.createObjectURL(await selected.atlas.getFile());
        pathJSON = window.URL.createObjectURL(await selected.json.getFile());
        pathTexture = window.URL.createObjectURL(await selected.texture.getFile());
        requestAnimationFrame(LoadAsset);
    };
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function getFrameAsBlob(mimeType = "image/png", quality = 1) {
    return new Promise((success) => {
        requestAnimationFrame(function() {
            canvas.toBlob(blob => success(blob), mimeType, quality)
        })
    })
}

async function getFrameAsDataUrl(mimeType = "image/png", quality = 1) {
    return new Promise((success) => {
        requestAnimationFrame(function() {
            success(canvas.toDataURL(mimeType, quality));
        })
    })
}

async function ExportFiles() {
    const idolList = $("#idolList")[0];
    const status = $("#status")[0];
    const animationList = $("#animationList")[0];

    for (let i = 1; i < idolList.childElementCount; i++) {
        status.textContent = `${i} / ${idolList.childElementCount - 1}`
        idolList.selectedIndex = i;
        let name = idolList.childNodes[i].value
        await idolList.onchange();
        await delay(300);
        let options = [...animationList.options]
        .filter(x => {
            let val = x.value;
            if (val == "on" || val == "off") {
                return true;
            }
            let split = val.split("_");
            if (split[0] == "eye") {
                return false;
            }
            return split.find(x => x == "on" || x == "off");
        });
        let j = -1;
        do {
            let option = options[j];
            if (option) {option.selected = true; animationList.onchange(); await delay(500)}
            let blob = await getFrameAsBlob();
            let fileHandle = await directoryHandle.getFileHandle(`${name}${option?.value ? "_" + option.value : ""}.png`, {create: true})
            let file = await fileHandle.createWritable();
            await file.write(blob);
            await file.close()
        } while (options[++j]);
    }
}

async function DownloadAsFile() {
    const idolList = $("#idolList")[0];
    let fileName = idolList.selectedOptions?.[0]?.value || "canvas"
    let dataUrl = await getFrameAsDataUrl();
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${fileName}.png`
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function ExportFrames() {
    const status = $("#status")[0];
    const saveFolderHandle = await window.showDirectoryPicker({ id: "spineViewer-exportFrames", mode: "readwrite" });
    status.textContent = "Rendering"
    await LoadAssetAndStartRecording();
    
    for (let i = 0; i < recordFrames.length; i++)
    {
        status.textContent = `${i + 1} / ${recordFrames.length}`
        let fileHandle = await saveFolderHandle.getFileHandle(`${i}.webp`, {create: true})
        let file = await fileHandle.createWritable();
        let frame = recordFrames[i];
        await file.write(frame);
        await file.close()
    }
    status.textContent = "Complete"
    recordFrames = [];
}

function UpdateConfigs() {
    frameRate = Number($("#fps")[0].value);
    sdConfigs.width = Number($("#width")[0].value);
    sdConfigs.height = Number($("#height")[0].value);
    sdConfigs.offsetX = Number($("#offsetX")[0].value);
    sdConfigs.offsetY = Number($("#offsetY")[0].value);
    exportQuality = Number($("#quality")[0].value) / 100.0
}

Init();

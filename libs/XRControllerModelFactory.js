THREE.XRControllerModelFactory = (function () {

    function XRControllerModel() {

        THREE.Object3D.call(this);

        this.motionController = null;
        this.envMap = null;

    }

    XRControllerModel.prototype = Object.assign(Object.create(THREE.Object3D.prototype), {

        constructor: XRControllerModel,

        setEnvironmentMap: function (envMap) {

            if (this.envMap == envMap) {
                return this;
            }

            this.envMap = envMap;
            this.traverse((child) => {
                if (child.isMesh) {
                    child.material.envMap = this.envMap;
                    child.material.needsUpdate = true;
                }
            });

            return this;
        },

        /**
         * Polls data from the XRInputSource and updates the model's components to match
         * the real world data
         */
        updateMatrixWorld: function (force) {

            THREE.Object3D.prototype.updateMatrixWorld.call(this, force);

            if (!this.motionController) return;

            // Cause the MotionController to poll the Gamepad for data
            this.motionController.updateFromGamepad();

            // Update the 3D model to reflect the button, thumbstick, and touchpad state
            Object.values(this.motionController.components).forEach((component) => {
                // Update node data based on the visual responses' current states
                Object.values(component.visualResponses).forEach((visualResponse) => {
                    const { valueNode, minNode, maxNode, value, valueNodeProperty } = visualResponse;

                    // Skip if the visual response node is not found. No error is needed,
                    // because it will have been reported at load time.
                    if (!valueNode) return;

                    // Calculate the new properties based on the weight
                    if (valueNodeProperty === 'visibility') {
                        valueNode.visible = value;
                    } else if (valueNodeProperty === 'transform') {
                        const minValue = minNode.quaternion.clone();
                        const maxValue = maxNode.quaternion.clone();

                        valueNode.quaternion.slerpQuaternions(minValue, maxValue, value);
                    }
                });
            });
        }
    });

    /**
     * Walks the model's tree to find the nodes needed to animate the components and
     * saves them to the motionController components for use in the frame loop. When
     * touchpads are found, attaches a touch dot to them.
     */
    function findNodes(motionController, scene) {
        // Loop through the components and find the nodes needed for each components' visual responses
        Object.values(motionController.components).forEach((component) => {
            const { type, touchPointNodeName, visualResponses } = component;

            if (type === 'touchpad') {
                component.touchPointNode = scene.getObjectByName(touchPointNodeName);
                if (component.touchPointNode) {
                    // Attach a touch dot to the touchpad.
                    const sphereGeometry = new THREE.SphereGeometry(0.001);
                    const material = new THREE.MeshBasicMaterial({ color: 0x0000FF });
                    const sphere = new THREE.Mesh(sphereGeometry, material);
                    component.touchPointNode.add(sphere);
                } else {
                    console.warn(`Could not find touch dot, ${component.touchPointNodeName}, in touchpad component ${component.id}`);
                }
            }

            // Loop through all the visual responses to be applied to this component
            Object.values(visualResponses).forEach((visualResponse) => {
                const { valueNodeName, minNodeName, maxNodeName, valueNodeProperty } = visualResponse;

                // If animating a transform, find the two nodes to be interpolated between.
                if (valueNodeProperty === 'transform') {
                    visualResponse.minNode = scene.getObjectByName(minNodeName);
                    visualResponse.maxNode = scene.getObjectByName(maxNodeName);

                    // If the extents cannot be found, skip this animation
                    if (!visualResponse.minNode) {
                        console.warn(`Could not find ${minNodeName} in the model`);
                        return;
                    }

                    if (!visualResponse.maxNode) {
                        console.warn(`Could not find ${maxNodeName} in the model`);
                        return;
                    }
                }

                // If the target node cannot be found, skip this animation
                visualResponse.valueNode = scene.getObjectByName(valueNodeName);
                if (!visualResponse.valueNode) {
                    console.warn(`Could not find ${valueNodeName} in the model`);
                }
            });
        });
    }

    function addAssetSceneToControllerModel(controllerModel, scene) {
        // Find the nodes needed for animation and cache them on the motionController.
        findNodes(controllerModel.motionController, scene);

        // Apply any environment map that the mesh already has set.
        if (controllerModel.envMap) {
            scene.traverse((child) => {
                if (child.isMesh) {
                    child.material.envMap = controllerModel.envMap;
                    child.material.needsUpdate = true;
                }
            });
        }

        // Add the glTF scene to the controllerModel.
        controllerModel.add(scene);
    }

    var DEFAULT_PROFILES_PATH = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles';
    var DEFAULT_PROFILE = 'generic-trigger';

    class XRControllerModelFactory {
        constructor(gltfLoader, path) {
            this.gltfLoader = gltfLoader || new THREE.GLTFLoader();
            this.path = path || DEFAULT_PROFILES_PATH;
            this._assetCache = {};

            // If a GLTFLoader wasn't supplied to the constructor create a new one.
            if (!gltfLoader) {
                this.gltfLoader.setPath(this.path);
            }
        }

        createControllerModel(controller) {
            const controllerModel = new XRControllerModel();
            let scene = null;

            controller.addEventListener('connected', (event) => {
                const xrInputSource = event.data;

                if (xrInputSource.targetRayMode !== 'tracked-pointer' || !xrInputSource.gamepad) return;

                fetchProfile(xrInputSource, this.path, DEFAULT_PROFILE, (defaultProfile) => {
                    controllerModel.motionController = new MotionController(
                        xrInputSource,
                        xrInputSource.gamepad,
                        defaultProfile
                    );

                    const cachedAsset = this._assetCache[controllerModel.motionController.assetUrl];
                    if (cachedAsset) {
                        scene = cachedAsset.scene.clone();
                        addAssetSceneToControllerModel(controllerModel, scene);
                    } else {
                        if (!this.gltfLoader) {
                            throw new Error('GLTFLoader not set.');
                        }

                        this.gltfLoader.load(controllerModel.motionController.assetUrl, (asset) => {
                            this._assetCache[controllerModel.motionController.assetUrl] = asset;
                            scene = asset.scene.clone();
                            addAssetSceneToControllerModel(controllerModel, scene);
                        },
                        null,
                        () => {
                            throw new Error(`Can find no controller model for ${controllerModel.motionController.assetUrl}`);
                        });
                    }
                });
            });

            controller.addEventListener('disconnected', () => {
                controllerModel.motionController = null;
                while (controllerModel.children.length > 0) {
                    controllerModel.remove(controllerModel.children[0]);
                }
            });

            return controllerModel;
        }
    }

    // Basic implementation - only fetches the first profile
    function fetchProfile(xrInputSource, basePath, defaultProfile, callback) {
        if (!xrInputSource.profiles) {
            callback(null);
            return;
        }

        // Get the array of profiles
        const supportedProfiles = xrInputSource.profiles;
        
        // Use the highest priority profile
        let profileId = supportedProfiles.find((profileId) => {
            return !!(profileId && profileId !== 'none');
        });

        if (!profileId) {
            profileId = defaultProfile;
        }

        // Construct the profile URL
        const profileURL = `${basePath}/${profileId}/profile.json`;

        // Fetch the profile JSON
        fetch(profileURL).then((response) => {
            if (response.status === 200) {
                return response.json();
            } else {
                return null;
            }
        }).then((profile) => {
            if (!profile) {
                console.warn(`No matching profile for ${xrInputSource.profiles}`);
                callback(null);
                return;
            }

            callback(profile);
        }).catch((err) => {
            console.warn(`Error loading profile for ${xrInputSource.profiles} - ${err}`);
            callback(null);
        });
    }

    // Motion controller class adapted from https://github.com/immersive-web/webxr-input-profiles/tree/master/packages/motion-controllers
    class MotionController {
        constructor(xrInputSource, gamepad, profile) {
            this.xrInputSource = xrInputSource;
            this.gamepad = gamepad;
            this.profile = profile;

            this.layoutDescription = null;
            this.components = {};

            let layoutDescriptionPath;
            if (this.profile.layouts && this.profile.layouts[xrInputSource.handedness]) {
                this.layoutDescription = this.profile.layouts[xrInputSource.handedness];
                this.assetUrl = this.layoutDescription.assetPath ? 
                    DEFAULT_PROFILES_PATH + '/' + this.layoutDescription.assetPath : null;
            } else {
                this.layoutDescription = null;
                this.assetUrl = null;
            }

            // Make empty components array
            this.components = {};

            // Initialize components based on the layout description
            if (this.layoutDescription) {
                for (const component of Object.values(this.layoutDescription.components)) {
                    this.components[component.id] = {
                        id: component.id,
                        type: component.type,
                        gamepadIndices: component.gamepadIndices,
                        touchPointNodeName: component.touchPointNodeName,
                        visualResponses: {},
                    };

                    // Add the visual responses
                    if (component.visualResponses) {
                        for (const visualResponse of Object.values(component.visualResponses)) {
                            this.components[component.id].visualResponses[visualResponse.id] = {
                                id: visualResponse.id,
                                valueNodeName: visualResponse.valueNodeName,
                                minNodeName: visualResponse.minNodeName,
                                maxNodeName: visualResponse.maxNodeName,
                                valueNodeProperty: visualResponse.valueNodeProperty,
                                value: visualResponse.value,
                                minNode: null,
                                maxNode: null,
                                valueNode: null,
                            };
                        }
                    }
                }
            }
        }

        updateFromGamepad() {
            if (!this.gamepad) return;

            // Update visual responses on components
            for (const component of Object.values(this.components)) {
                let value = 0;

                // Get the value based on the component type
                if (component.type === 'trigger' || component.type === 'squeeze') {
                    value = this.gamepad.buttons[component.gamepadIndices.button].value;
                } else if (component.type === 'touchpad' || component.type === 'thumbstick') {
                    const buttonIndex = component.gamepadIndices.button;
                    if (buttonIndex !== undefined && buttonIndex !== null) {
                        value = this.gamepad.buttons[buttonIndex].value;
                    }

                    // Position the touch dot
                    if (component.touchPointNodeName) {
                        const touchPointNode = component.touchPointNode;
                        if (touchPointNode) {
                            const axisXIndex = component.gamepadIndices.xAxis;
                            const axisYIndex = component.gamepadIndices.yAxis;
                            if (axisXIndex !== undefined && axisYIndex !== undefined) {
                                const x = this.gamepad.axes[axisXIndex];
                                const y = this.gamepad.axes[axisYIndex];

                                // Position the touch dot based on the input
                                if (Math.sqrt(x * x + y * y) > 0.0001) {
                                    touchPointNode.position.set(x * 0.02, 0, -y * 0.02); // Scale and invert Y
                                    touchPointNode.visible = true;
                                } else {
                                    touchPointNode.visible = false;
                                }
                            }
                        }
                    }
                } else if (component.type === 'button') {
                    value = this.gamepad.buttons[component.gamepadIndices.button].value;
                }

                // Update all the visual responses with this value
                for (const visualResponse of Object.values(component.visualResponses)) {
                    visualResponse.value = value;
                }
            }
        }
    }

    return XRControllerModelFactory;
})();
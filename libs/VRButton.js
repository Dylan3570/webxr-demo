var VRButton = {
    createButton: function (renderer) {
        if ('xr' in navigator) {
            const button = document.createElement('button');
            button.style.display = 'none';
            button.style.height = '40px';

            function showEnterVR() {
                let currentSession = null;

                async function onSessionStarted(session) {
                    session.addEventListener('end', onSessionEnded);

                    renderer.xr.setSession(session);
                    button.textContent = 'EXIT VR';

                    currentSession = session;
                }

                function onSessionEnded() {
                    currentSession.removeEventListener('end', onSessionEnded);

                    button.textContent = 'ENTER VR';

                    currentSession = null;
                }

                button.style.display = '';
                button.style.cursor = 'pointer';
                button.style.left = 'calc(50% - 50px)';
                button.style.width = '100px';

                button.textContent = 'ENTER VR';

                button.onmouseenter = function () {
                    button.style.opacity = '1.0';
                };

                button.onmouseleave = function () {
                    button.style.opacity = '0.5';
                };

                button.onclick = function () {
                    if (currentSession === null) {
                        const sessionInit = { optionalFeatures: ['local-floor', 'bounded-floor'] };
                        navigator.xr.requestSession('immersive-vr', sessionInit).then(onSessionStarted);
                    } else {
                        currentSession.end();
                    }
                };
            }

            function showWebXRNotFound() {
                button.style.display = '';
                button.style.cursor = 'auto';
                button.style.left = 'calc(50% - 75px)';
                button.style.width = '150px';
                button.textContent = 'VR NOT SUPPORTED';

                button.onmouseenter = null;
                button.onmouseleave = null;

                button.onclick = null;
            }

            if (navigator.xr.isSessionSupported) {
                navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
                    supported ? showEnterVR() : showWebXRNotFound();
                });
            } else {
                showWebXRNotFound();
            }

            return button;
        } else {
            const message = document.createElement('a');
            message.href = 'https://immersiveweb.dev/';
            message.innerHTML = 'WEBXR NOT AVAILABLE';
            message.style.left = 'calc(50% - 90px)';
            message.style.width = '180px';
            message.style.textDecoration = 'none';

            return message;
        }
    }
};
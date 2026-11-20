import { initFirstRunExperience } from '../firstRunExperience.js';
import { initKeySetup } from '../keySetup.js';
import { useLegacyFirstRunLauncher } from '../bdp/config/workspacePolicy.js';

/** Reveal welcome controls only after restoration and the loading transition. */
export function startStandaloneChrome({
  loadingScreen,
  styleManager,
  dataManager,
  signal,
}) {
  let disposed = false;
  let firstRun;
  let revealTimer;
  let resolveDelay;
  const minimumDelay = new Promise((resolve) => {
    resolveDelay = resolve;
  });
  const delayTimer = setTimeout(resolveDelay, 1000);
  const revealFirstRun = () => {
    if (disposed || signal.aborted || firstRun) return;
    clearTimeout(revealTimer);
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
    // The land workspace has no aircraft/military first-run missions. Do not
    // initialize the old dialog or its keyboard traps; key setup still works.
    if (!useLegacyFirstRunLauncher(document.body.dataset.bdpProduct)) return;
    firstRun = initFirstRunExperience({ styleManager, dataManager });
  };
  void Promise.all([styleManager.initialRestorePromise, minimumDelay])
    .catch(() => {
      /* Restoration reports its own outcome through the controls. */
    })
    .then(() => {
      if (disposed || signal.aborted) return;
      loadingScreen.classList.add('hidden');
      loadingScreen.addEventListener('transitionend', revealFirstRun, {
        once: true,
      });
      revealTimer = setTimeout(revealFirstRun, 900);
    });
  const keySetup = initKeySetup({ signal });
  // Own the pending initializer too; it must not reveal a dialog after abort.
  void keySetup.catch(() =>
    console.error('Provider settings initialization failed'),
  );
  return async () => {
    disposed = true;
    clearTimeout(delayTimer);
    clearTimeout(revealTimer);
    resolveDelay();
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
    firstRun?.destroy();
    (await keySetup.catch(() => null))?.destroy();
  };
}

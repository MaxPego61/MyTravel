function getMsalConfig() {
    return {
        auth: {
            clientId: window.MS_CLIENT_ID,
            authority: `https://login.microsoftonline.com/${window.MS_TENANT_ID}`,
            redirectUri: window.location.origin,
            postLogoutRedirectUri: window.location.origin
        }
    };
}

let msalInstance;

function signIn() {
    msalInstance.loginRedirect({
        scopes: ["User.Read"]
    });
}

function signOut() {
    const account = msalInstance.getAllAccounts()[0];
    msalInstance.logoutRedirect({
        account: account,
        postLogoutRedirectUri: window.location.origin
    });
}

// Whitelist client-side: nasconde l'app a chi non è autorizzato.
// NOTA IMPORTANTE: questo è solo un filtro cosmetico lato browser.
// /api/trips e /api/config non verificano ancora il token — chiunque
// conoscesse l'URL potrebbe chiamarli direttamente senza passare da qui.
// Da mettere in sicurezza in un prossimo step se serve davvero privacy.
const ALLOWED_EMAILS = [
    "pegoraro.massimo61@outlook.com",
    "terrymnz@outlook.com"
];

function checkLogin() {
    const accounts = msalInstance.getAllAccounts();
    const loginScreen = document.getElementById("login-screen");

    if (accounts.length === 0) {
        loginScreen.style.display = "flex";
        return false;
    }

    window.USER = accounts[0];

    if (!ALLOWED_EMAILS.includes(window.USER.username.toLowerCase())) {
        loginScreen.innerHTML = `
            <h2>Accesso non autorizzato</h2>
            <p>L'account Microsoft <b>${window.USER.username}</b> non è abilitato.</p>
        `;
        loginScreen.style.display = "flex";
        return false;
    }

    return true;
}

function addLogoutButton() {
    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logoutBtn";
    logoutBtn.innerText = "Logout";
    logoutBtn.onclick = signOut;
    document.body.appendChild(logoutBtn);
}

async function loadConfig() {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    window.MS_CLIENT_ID = cfg.msClientId;
    window.MS_TENANT_ID = cfg.msTenantId;
    window.GOOGLE_MAPS_API_KEY = cfg.googleMapsApiKey;
}

function loadGoogleKey() {
    return Promise.resolve(window.GOOGLE_MAPS_API_KEY);
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadConfig();

    msalInstance = new msal.PublicClientApplication(getMsalConfig());

    msalInstance.handleRedirectPromise().then(() => {
        const ok = checkLogin();
        if (ok) {
            addLogoutButton();
            startMyTravel();
        }
    }).catch(err => {
        console.error("MSAL ERROR:", err);
    });
});

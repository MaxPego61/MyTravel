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
        scopes: ["User.Read", "Files.Read"]
    });
}

function signOut() {
    const account = msalInstance.getAllAccounts()[0];
    msalInstance.logoutRedirect({
        account: account,
        postLogoutRedirectUri: window.location.origin
    });
}

// Silently gets a Microsoft Graph access token for the signed-in account.
// Used by photos.js to call OneDrive without a new interactive login.
async function getGraphToken() {
    const account = msalInstance.getAllAccounts()[0];
    if (!account) throw new Error("No signed-in account");

    const result = await msalInstance.acquireTokenSilent({
        scopes: ["Files.Read"],
        account: account
    });
    return result.accessToken;
}

// Client-side whitelist: hides the app from anyone not on the list.
// IMPORTANT NOTE: this is only a cosmetic filter in the browser.
// /api/trips and /api/config don't verify the token yet — anyone who
// knew the URL could call them directly without going through this.
// Worth hardening in a future step if real privacy is needed.
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
            <h2>Access not authorized</h2>
            <p>The Microsoft account <b>${window.USER.username}</b> is not enabled.</p>
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
            // addLogoutButton(); // scommenta solo per testare il logout MSAL
            startMyTravel();
        }
    }).catch(err => {
        console.error("MSAL ERROR:", err);
    });
});
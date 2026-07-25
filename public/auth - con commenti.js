// ===============================
// CONFIGURAZIONE MSAL
// ===============================

const msalConfig = {
    auth: {
        clientId: window.MS_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${window.MS_TENANT_ID}`,
        redirectUri: "https://mytravel-maxpego.vercel.app/"
    }
};

const msalInstance = new msal.PublicClientApplication(msalConfig);


// ===============================
// LOGIN
// ===============================

async function signIn() {
    await msalInstance.loginRedirect({
        scopes: ["User.Read"]
    });
}


// ===============================
// LOGOUT
// ===============================

async function signOut() {
    const account = msalInstance.getAllAccounts()[0];

    await msalInstance.logoutRedirect({
        account: account,
        postLogoutRedirectUri: "https://mytravel-maxpego.vercel.app/"
    });
}


// ===============================
// CONTROLLO LOGIN + EMAIL FAMILIARI
// ===============================

async function checkLogin() {
    const accounts = msalInstance.getAllAccounts();

    // Nessun login → mostra schermata di accesso
    if (accounts.length === 0) {
        document.body.innerHTML = `
            <div style="text-align:center; margin-top:80px;">
                <h2>MyTravel</h2>
                <p>Accesso riservato ai familiari</p>
                <button onclick="signIn()" 
                        style="padding:10px 20px; font-size:18px;">
                    Accedi con Microsoft
                </button>
            </div>
        `;
        return false;
    }

    // Utente autenticato
    window.USER = accounts[0];

    // ===============================
    // LISTA EMAIL FAMILIARI
    // ===============================
    const allowedEmails = [
        "pegoraro.massimo61@outlook.com",
        "terrymnz@outlook.com"
    ];

    // Se l'email non è nella lista → blocco
    if (!allowedEmails.includes(window.USER.username.toLowerCase())) {
        document.body.innerHTML = `
            <div style="text-align:center; margin-top:80px;">
                <h2>Accesso non autorizzato</h2>
                <p>L'account Microsoft <b>${window.USER.username}</b> non è abilitato.</p>
            </div>
        `;
        return false;
    }

    return true;
}

function addLogoutButton() {
    const logoutBtn = document.createElement("button");
    logoutBtn.innerText = "Logout";
    logoutBtn.style = "position:fixed; top:20px; right:20px; padding:10px;";
    logoutBtn.onclick = signOut;
    document.body.appendChild(logoutBtn);
}

document.addEventListener("DOMContentLoaded", () => {
    msalInstance.handleRedirectPromise().then(async () => {
        const ok = await checkLogin();
        if (ok) {
            addLogoutButton();
            startMyTravel();
        }
    });

});

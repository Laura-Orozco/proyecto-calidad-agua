// static/auth.js - Módulo de Autenticación con Google Identity Services
const GOOGLE_CLIENT_ID = "144217789481-591ojt4dohgjmm7542cohgef6hr9228k.apps.googleusercontent.com";

/**
 * Muestra el modal superpuesto bloqueando la vista de la estación.
 */
function mostrarModalLogin() {
  const modal = document.getElementById("loginModal");
  if (modal) {
    modal.style.display = "flex";
  }
}

/**
 * Oculta el modal de autenticación una vez validada la sesión.
 */
function ocultarModalLogin() {
  const modal = document.getElementById("loginModal");
  if (modal) {
    modal.style.display = "none";
  }
}

/**
 * Actualiza el encabezado de la página con los datos del usuario activo.
 */
function actualizarInterfazUsuario(usuario) {
  const lblNombre = document.getElementById("usuarioNombre");
  const imgAvatar = document.getElementById("usuarioAvatar");

  if (lblNombre) {
    lblNombre.innerText = usuario.name || usuario.email || "Operador";
  }

  if (imgAvatar) {
    if (usuario.picture) {
      imgAvatar.src = usuario.picture;
      imgAvatar.style.display = "inline-block";
    } else {
      imgAvatar.src = "";
      imgAvatar.style.display = "none";
    }
  }
}

/**
 * Decodifica el token JWT retornado por Google y almacena la sesión.
 */
function manejarCredencialGoogle(response) {
  try {
    const base64Url = response.credential.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    const usuario = JSON.parse(jsonPayload);

    // Guardar en almacenamiento local persistente
    localStorage.setItem("usuario_sesion", JSON.stringify(usuario));

    ocultarModalLogin();
    actualizarInterfazUsuario(usuario);
  } catch (err) {
    console.error("[Auth] Error al procesar la credencial de Google:", err);
  }
}

/**
 * Inicializa la librería de Google y dibuja el botón de inicio de sesión.
 */
function renderizarBotonGoogle() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    try {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: manejarCredencialGoogle,
        auto_select: false
      });

      const container = document.getElementById("googleBtnContainer");
      if (container) {
        container.innerHTML = "";
        google.accounts.id.renderButton(container, {
          theme: "outline",
          size: "large",
          shape: "rectangular",
          text: "signin_with",
          locale: "es",
          width: 280
        });
      }
    } catch (e) {
      console.warn("[Auth] Esperando inicialización de Google Identity...", e);
    }
  } else {
    // Si la librería de Google aún no termina de cargar, reintentar en 200 ms
    setTimeout(renderizarBotonGoogle, 200);
  }
}

/**
 * Modo de acceso directo para pruebas locales o sin conexión externa.
 */
function bypassDesarrollo() {
  const userDev = {
    name: "Operador de Laboratorio",
    email: "lab.ia@universidad.edu.co",
    picture: ""
  };
  localStorage.setItem("usuario_sesion", JSON.stringify(userDev));
  ocultarModalLogin();
  actualizarInterfazUsuario(userDev);
}

/**
 * Cierra la sesión activa, limpia la memoria y fuerza la reapertura del modal.
 */
function cerrarSesion() {
  localStorage.removeItem("usuario_sesion");
  sessionStorage.clear();

  if (window.google && window.google.accounts && window.google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }

  const lblNombre = document.getElementById("usuarioNombre");
  const imgAvatar = document.getElementById("usuarioAvatar");
  if (lblNombre) lblNombre.innerText = "No autenticado";
  if (imgAvatar) {
    imgAvatar.src = "";
    imgAvatar.style.display = "none";
  }

  mostrarModalLogin();
  renderizarBotonGoogle();
}

/**
 * Evalúa si existe una sesión válida guardada en el navegador.
 */
function verificarEstadoSesion() {
  const sesionGuardada = localStorage.getItem("usuario_sesion");
  if (!sesionGuardada) {
    mostrarModalLogin();
    renderizarBotonGoogle();
  } else {
    try {
      const usuario = JSON.parse(sesionGuardada);
      if (!usuario || (!usuario.email && !usuario.name)) {
        throw new Error("Estructura de sesión no válida");
      }
      ocultarModalLogin();
      actualizarInterfazUsuario(usuario);
    } catch (e) {
      localStorage.removeItem("usuario_sesion");
      mostrarModalLogin();
      renderizarBotonGoogle();
    }
  }
}

// Ejecución durante la carga del DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", verificarEstadoSesion);
} else {
  verificarEstadoSesion();
}

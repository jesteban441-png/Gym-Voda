/* ============================================================================
   VODA FIT — BASELINE DE CLASIFICACIÓN  (Etapa 2C)
   ============================================================================

   QUÉ ES
   Una foto exacta de cómo quedan clasificados HOY los ejercicios oficiales que
   tienen entrada en MUSCLE_MAP. No es una fuente de datos de la app: la app no
   lee este archivo. Lo lee únicamente tests-v31.html, para comparar.

   PARA QUÉ
   Las etapas que vienen (D2 músculos secundarios, D5 ejercicios nuevos, D6
   contenido, GIFs) van a tocar MUSCLE_MAP. El riesgo concreto es silencioso:
   agregar una región asistente con intensidad mayor o igual al máximo actual
   cambia la región principal, y con ella el subgrupo, el grupo, el pool del
   generador y las rutinas guardadas — sin ningún error, sin ningún síntoma
   visible hasta que una rutina sale rara.

   Esta baseline convierte ese cambio silencioso en un test que falla diciendo
   exactamente qué ejercicio cambió, de qué a qué.

   CÓMO SE GENERÓ
   Ejecutando el código real de index.html en el navegador y leyendo las
   funciones existentes: exerciseMuscleGroup(), exercisePrimarySubgroup() y
   MUSCLE_MAP. Nada se recalculó ni se reimplementó acá.

   ORDEN
   Alfabético en es-AR. Es determinista a propósito: regenerar la baseline sin
   cambios reales produce un archivo byte a byte idéntico, así que cualquier
   diff es un cambio de verdad.

   CÓMO SE ACTUALIZA
   Cuando un cambio de clasificación sea DELIBERADO (por ejemplo, D2 decide que
   un asistente nuevo pasa a ser el principal de un ejercicio), se actualiza la
   fila de ese ejercicio en el mismo commit que el cambio, y el diff deja
   constancia de qué se decidió. Nunca se actualiza "para que el test pase":
   si el test falla y nadie quiso ese cambio, el bug está en MUSCLE_MAP.

   QUÉ NO ESTÁ ACÁ
   Los 10 ejercicios de cardio, que no tienen MUSCLE_MAP y por lo tanto no
   tienen grupo ni subgrupo (ver `totales.sinGrupo`). No es un hueco: es la
   decisión de producto vigente. Si alguna vez se les asigna musculatura,
   entran a esta baseline.
   ========================================================================= */

window.VODAFIT_BASELINE_CLASIFICACION = {
  etapa: "2C",
  // Commit sobre el que se tomó la foto (HEAD al generarla).
  commitBase: "31d0407",
  // Estado del catálogo heredado de 2B.
  totales: {
    oficiales: 111,       // EXERCISES completo: ya no hay retirados
    conMuscleMap: 101,    // los que entran a esta baseline
    sinGrupo: 10,         // los 10 de cardio
    sinSubgrupo: 10,      // los mismos 10
    aliases: 38,
  },

  /* CASOS ESPECIALES detectados al generar la baseline.
     Se declaran, NO se corrigen en 2C. Cada uno es una decisión pendiente. */
  casosEspeciales: {
    // Ningún ejercicio tiene dos regiones empatadas en la intensidad máxima,
    // así que hoy la región principal es única en los 101. Nada en el código
    // lo garantiza: exercisePrimarySubgroup() usa `>` estricto, de modo que
    // ante un empate ganaría la primera región DECLARADA en el array. Es una
    // dependencia del orden de escritura, latente mientras no haya empates.
    empatesEnMaxima: [],

    // Tres ejercicios cuya intensidad máxima es 0.9, no 1. Funcionan bien
    // porque la regla es "máximo relativo", no "=== 1". Quedan anotados porque
    // cualquier regla futura que compare contra 1 los rompería.
    maximoDistintoDeUno: [
      "Fondos de tríceps en banco",
      "Patada de tríceps",
      "Press cerrado",
    ],

    // Única pierna que no se puede asignar a uno de los 4 sub-focos de pierna:
    // exerciseSubgroup10() devuelve null porque LEG_FOCUS_TO_SUBGROUP10 no
    // tiene clave para "adductors". Es la decisión abierta D3.
    subgrupo10Nulo: [
      "Aductores en máquina",
    ],

    // `diagram` es un campo vestigial: desde V32 ningún consumidor lo lee (la
    // silueta se elige con viewsForRegions, a partir de las intensidades). Se
    // incluye en la baseline igual, porque es parte de la entrada de
    // MUSCLE_MAP y un cambio ahí debe quedar visible.
    campoVestigial: "diagram",
  },

  /* Una fila por ejercicio:
       ej       nombre canónico (se resuelve a sí mismo: verificado en los tests)
       grupo    exerciseMuscleGroup()
       subgrupo exercisePrimarySubgroup()
       diagram  MUSCLE_MAP[ej].diagram
       t        MUSCLE_MAP[ej].t — regiones e intensidades, en su orden original */
  ejercicios: [
  { ej:"Abdominales crunch", grupo:"Core", subgrupo:"core", diagram:"front-upper", t:[["abs",1]] },
  { ej:"Abductores en máquina", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["glutes",1]] },
  { ej:"Aductores en máquina", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["adductors",1]] },
  { ej:"Aperturas de pecho con mancuernas en banco inclinado", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-upper",1]] },
  { ej:"Aperturas de pecho con mancuernas en banco plano", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-mid",1]] },
  { ej:"Arnold press", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-front",1],["shoulder-lateral",0.7]] },
  { ej:"Crunch en polea", grupo:"Core", subgrupo:"core", diagram:"front-upper", t:[["abs",1]] },
  { ej:"Curl con barra", grupo:"Brazos", subgrupo:"biceps", diagram:"front-upper", t:[["biceps-short",1],["biceps-long",0.8]] },
  { ej:"Curl con mancuernas", grupo:"Brazos", subgrupo:"biceps", diagram:"front-upper", t:[["biceps-long",1],["biceps-short",0.8]] },
  { ej:"Curl con mancuernas alternado", grupo:"Brazos", subgrupo:"biceps", diagram:"front-upper", t:[["biceps-long",1],["biceps-short",0.8]] },
  { ej:"Curl con mancuernas banco inclinado", grupo:"Brazos", subgrupo:"biceps", diagram:"front-upper", t:[["biceps-long",1],["biceps-short",0.5]] },
  { ej:"Curl concentrado", grupo:"Brazos", subgrupo:"biceps", diagram:"front-upper", t:[["biceps-short",1],["biceps-long",0.5]] },
  { ej:"Curl de muñeca", grupo:"Brazos", subgrupo:"antebrazo", diagram:"front-upper", t:[["forearms",1]] },
  { ej:"Curl de muñeca inverso", grupo:"Brazos", subgrupo:"antebrazo", diagram:"front-upper", t:[["forearms",1]] },
  { ej:"Curl en polea", grupo:"Brazos", subgrupo:"biceps", diagram:"front-upper", t:[["biceps-long",1],["biceps-short",0.85]] },
  { ej:"Curl en polea unilateral", grupo:"Brazos", subgrupo:"biceps", diagram:"front-upper", t:[["biceps-long",1],["biceps-short",0.85]] },
  { ej:"Curl martillo", grupo:"Brazos", subgrupo:"biceps", diagram:"front-upper", t:[["biceps-long",1],["biceps-short",0.4]] },
  { ej:"Curl Scott (predicador)", grupo:"Brazos", subgrupo:"biceps", diagram:"front-upper", t:[["biceps-short",1],["biceps-long",0.5]] },
  { ej:"Dominadas", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.4]] },
  { ej:"Dominadas supinas", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.3]] },
  { ej:"Elevación de piernas colgado", grupo:"Core", subgrupo:"core", diagram:"front-upper", t:[["abs",1]] },
  { ej:"Elevación lateral en máquina", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-lateral",1]] },
  { ej:"Elevación lateral en polea", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-lateral",1]] },
  { ej:"Encogimientos con barra", grupo:"Hombros", subgrupo:"hombros", diagram:"back-upper", t:[["traps",1],["rhomboids",0.3]] },
  { ej:"Encogimientos con mancuernas", grupo:"Hombros", subgrupo:"hombros", diagram:"back-upper", t:[["traps",1],["rhomboids",0.3]] },
  { ej:"Encogimientos en máquina", grupo:"Hombros", subgrupo:"hombros", diagram:"back-upper", t:[["traps",1],["rhomboids",0.25]] },
  { ej:"Estocadas con mancuerna", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["glutes",1],["quads-front",0.7],["quads-outer",0.5]] },
  { ej:"Extensión de piernas", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["quads-front",1],["quads-inner",0.8],["quads-outer",0.7]] },
  { ej:"Extensión de tríceps con mancuerna", grupo:"Brazos", subgrupo:"triceps", diagram:"back-upper", t:[["triceps-long",1],["triceps-lateral",0.5],["triceps-medial",0.4]] },
  { ej:"Extensión de tríceps en polea", grupo:"Brazos", subgrupo:"triceps", diagram:"back-upper", t:[["triceps-lateral",1],["triceps-long",0.5],["triceps-medial",0.4]] },
  { ej:"Extensión de tríceps en polea con barra", grupo:"Brazos", subgrupo:"triceps", diagram:"back-upper", t:[["triceps-lateral",1],["triceps-medial",0.6],["triceps-long",0.4]] },
  { ej:"Face Pull", grupo:"Hombros", subgrupo:"hombros", diagram:"back-upper", t:[["shoulder-rear",1],["rhomboids",0.4],["traps",0.3]] },
  { ej:"Flexiones de brazo", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-mid",1],["shoulder-front",0.3]] },
  { ej:"Fondos de tríceps en banco", grupo:"Brazos", subgrupo:"triceps", diagram:"back-upper", t:[["triceps-lateral",0.9],["triceps-long",0.8],["triceps-medial",0.5]] },
  { ej:"Fondos inclinado", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-lower",1],["shoulder-front",0.3]] },
  { ej:"Gemelos en máquina", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["calves-gastro",1],["calves-soleus",0.5]] },
  { ej:"Gemelos en prensa", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["calves-gastro",1],["calves-soleus",0.5]] },
  { ej:"Gemelos parado con mancuerna", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["calves-gastro",1],["calves-soleus",0.5]] },
  { ej:"Gemelos sentado en máquina", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["calves-soleus",1],["calves-gastro",0.5]] },
  { ej:"Giro ruso (russian twist)", grupo:"Core", subgrupo:"core", diagram:"front-upper", t:[["obliques",1],["abs",0.4]] },
  { ej:"Hip thrust con barra", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["glutes",1],["hamstrings",0.4]] },
  { ej:"Hip thrust en máquina", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["glutes",1],["hamstrings",0.4]] },
  { ej:"Hiperextensiones", grupo:"Core", subgrupo:"core", diagram:"back-upper", t:[["lower-back",1],["glutes",0.5],["hamstrings",0.45]] },
  { ej:"Isquio acostado", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["hamstrings",1]] },
  { ej:"Isquio sentado", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["hamstrings",1]] },
  { ej:"Jalón agarre neutro", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.4],["biceps-long",0.35]] },
  { ej:"Jalón agarre supino", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["biceps-long",0.45],["rhomboids",0.35]] },
  { ej:"Jalón al pecho", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.3]] },
  { ej:"Mountain climbers", grupo:"Core", subgrupo:"core", diagram:"front-upper", t:[["abs",1]] },
  { ej:"Patada de glúteo en máquina", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["glutes",1],["hamstrings",0.3]] },
  { ej:"Patada de glúteo en polea", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["glutes",1],["hamstrings",0.3]] },
  { ej:"Patada de tríceps", grupo:"Brazos", subgrupo:"triceps", diagram:"back-upper", t:[["triceps-long",0.9],["triceps-medial",0.7],["triceps-lateral",0.4]] },
  { ej:"Pec Fly", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-mid",1]] },
  { ej:"Pec Fly invertido", grupo:"Hombros", subgrupo:"hombros", diagram:"back-upper", t:[["shoulder-rear",1],["rhomboids",0.4]] },
  { ej:"Peso muerto con barra", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["glutes",1],["hamstrings",0.8],["lower-back",0.5],["traps",0.25]] },
  { ej:"Peso muerto con mancuernas", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["glutes",1],["hamstrings",0.8],["lower-back",0.45]] },
  { ej:"Peso muerto rumano con barra", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["hamstrings",1],["glutes",0.65],["lower-back",0.4]] },
  { ej:"Peso muerto rumano con mancuernas", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["hamstrings",1],["glutes",0.6],["lower-back",0.35]] },
  { ej:"Peso muerto sumo con barra", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["glutes",1],["hamstrings",0.7],["adductors",0.6],["lower-back",0.4]] },
  { ej:"Peso muerto sumo con mancuernas", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["glutes",1],["hamstrings",0.65],["adductors",0.55],["lower-back",0.35]] },
  { ej:"Plancha", grupo:"Core", subgrupo:"core", diagram:"front-upper", t:[["abs",1],["obliques",0.3]] },
  { ej:"Plancha lateral", grupo:"Core", subgrupo:"core", diagram:"front-upper", t:[["obliques",1]] },
  { ej:"Prensa inclinada", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["quads-front",1],["quads-outer",0.7],["quads-inner",0.65],["glutes",0.45]] },
  { ej:"Press cerrado", grupo:"Brazos", subgrupo:"triceps", diagram:"back-upper", t:[["triceps-lateral",0.9],["triceps-medial",0.7],["triceps-long",0.6]] },
  { ej:"Press de banca con barra", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-mid",1],["shoulder-front",0.35]] },
  { ej:"Press de banca declinado", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-lower",1],["shoulder-front",0.25]] },
  { ej:"Press de banca declinado en Smith", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-lower",1],["shoulder-front",0.25]] },
  { ej:"Press de banca inclinado con barra", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-upper",1],["shoulder-front",0.4]] },
  { ej:"Press de banca inclinado con mancuernas", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-upper",1],["shoulder-front",0.35]] },
  { ej:"Press de banca inclinado en Smith", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-upper",1],["shoulder-front",0.35]] },
  { ej:"Press de banca plano en Smith", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-mid",1],["shoulder-front",0.3]] },
  { ej:"Press de hombros con mancuernas", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-front",1],["shoulder-lateral",0.6]] },
  { ej:"Press de hombros en máquina", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-front",1],["shoulder-lateral",0.6],["triceps-lateral",0.3]] },
  { ej:"Press de pecho en polea", grupo:"Pecho", subgrupo:"pecho", diagram:"front-upper", t:[["chest-mid",1],["shoulder-front",0.25]] },
  { ej:"Press francés", grupo:"Brazos", subgrupo:"triceps", diagram:"back-upper", t:[["triceps-long",1],["triceps-lateral",0.5],["triceps-medial",0.4]] },
  { ej:"Press militar con barra", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-front",1],["shoulder-lateral",0.5]] },
  { ej:"Press militar con mancuernas sentado", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-front",1],["shoulder-lateral",0.6]] },
  { ej:"Press tras nuca con barra", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-lateral",1],["shoulder-front",0.7],["triceps-lateral",0.4]] },
  { ej:"Puente de glúteos", grupo:"Piernas", subgrupo:"piernas", diagram:"back-leg", t:[["glutes",1],["hamstrings",0.3]] },
  { ej:"Pullover", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["triceps-long",0.25]] },
  { ej:"Remo al mentón", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-lateral",1],["traps",0.45],["biceps-short",0.25]] },
  { ej:"Remo con barra", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.6],["lower-back",0.3]] },
  { ej:"Remo con mancuerna unilateral", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.5]] },
  { ej:"Remo en Hammer", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.6]] },
  { ej:"Remo en máquina", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.5]] },
  { ej:"Remo en máquina agarre ancho", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["rhomboids",1],["lats",0.6],["shoulder-rear",0.4]] },
  { ej:"Remo en máquina unilateral", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.55]] },
  { ej:"Remo en polea baja", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.6]] },
  { ej:"Remo en T", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["lats",1],["rhomboids",0.6]] },
  { ej:"Remo en TRX", grupo:"Espalda", subgrupo:"espalda", diagram:"back-upper", t:[["rhomboids",1],["lats",0.7],["shoulder-rear",0.35]] },
  { ej:"Rueda abdominal", grupo:"Core", subgrupo:"core", diagram:"front-upper", t:[["abs",1],["obliques",0.3]] },
  { ej:"Sentadilla búlgara", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["quads-front",1],["quads-outer",0.8],["glutes",0.6],["quads-inner",0.5]] },
  { ej:"Sentadilla con barra", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["quads-front",1],["quads-outer",0.8],["quads-inner",0.7],["glutes",0.55],["adductors",0.35]] },
  { ej:"Sentadilla frontal", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["quads-front",1],["quads-inner",0.75],["quads-outer",0.6],["glutes",0.45],["adductors",0.3]] },
  { ej:"Sentadilla Hack", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["quads-front",1],["quads-outer",0.7],["quads-inner",0.65],["glutes",0.4]] },
  { ej:"Sentadilla Smith", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["quads-front",1],["quads-outer",0.7],["quads-inner",0.65],["glutes",0.45]] },
  { ej:"Sentadilla Sumo", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["glutes",1],["adductors",0.75],["quads-inner",0.6],["quads-outer",0.4]] },
  { ej:"Step Up", grupo:"Piernas", subgrupo:"piernas", diagram:"front-leg", t:[["glutes",1],["quads-front",0.7],["quads-outer",0.45]] },
  { ej:"Vuelos frontales", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-front",1]] },
  { ej:"Vuelos laterales con mancuerna", grupo:"Hombros", subgrupo:"hombros", diagram:"front-upper", t:[["shoulder-lateral",1]] },
  { ej:"Vuelos pájaro", grupo:"Hombros", subgrupo:"hombros", diagram:"back-upper", t:[["shoulder-rear",1],["rhomboids",0.3]] },
  ],
};

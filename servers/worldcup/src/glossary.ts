export interface GlossaryEntry {
  label: string;
  def: string;
  category: string;
  keywords?: string[];
}

// Sinónimos/conjugaciones curados para los casos donde la palabra que Cal usaría
// (típicamente un verbo conjugado) no comparte raíz/prefijo con el sustantivo de
// la definición ("corrieron" vs "distancia recorrida" no matchea por prefijo).
const KEYWORD_OVERRIDES: Record<string, string[]> = {
  DefensivePressuresApplied: ["presiono", "presionaron", "presionar", "presiona"],
  ForcedTurnovers: ["recupero", "recuperaron", "robo", "robaron", "robos", "quito"],
  TotalDistance: ["corrio", "corrieron", "corredor", "corredores", "kilometros", "recorrio", "recorrieron"],
  DistanceHighSpeedSprinting: ["esprinto", "esprintaron"],
  TakeOnsCompleted: ["gambeteo", "gambetearon", "regateo", "regatearon", "driblo", "driblaron"],
  Assists: ["asistio", "asistieron", "dio"],
  GoalkeeperSaves: ["atajo", "atajaron", "tapo", "tapadas"],
  Threat: ["peligro", "peligroso", "peligrosidad"],
  Goals: ["metio", "metieron", "convirtio", "anoto"],
  YellowCards: ["amonesto", "amonestado"],
  FoulsAgainst: ["cometio", "cometieron"],
  AttemptAtGoal: ["tiro", "tiros", "disparo", "disparos", "pateo"],
};

// Diccionario ES -> nombre crudo de FIFA para las 141 stats de `stats_completas`.
// Generado desde el glosario del artifact (2026-07-12) -- no editar a mano sin
// actualizar también el artifact para que no queden desincronizados.
export const STAT_GLOSSARY: Record<string, GlossaryEntry> = {
  "CleanSheets": { label: "Vallas invictas", def: "Partidos en los que el equipo no recibió ningún gol.", category: "Goles y modelo" },
  "Goals": { label: "Goles", def: "Goles anotados.", category: "Goles y modelo" },
  "GoalsConceded": { label: "Goles recibidos", def: "Goles recibidos.", category: "Goles y modelo" },
  "GoalsFromDirectFreeKicks": { label: "Goles de tiro libre directo", def: "Goles marcados directo de tiro libre, sin que la toque nadie más antes de entrar.", category: "Goles y modelo" },
  "GoalsInsideThePenaltyArea": { label: "Goles dentro del área", def: "Goles marcados desde dentro del área rival.", category: "Goles y modelo" },
  "GoalsOutsideThePenaltyArea": { label: "Goles fuera del área", def: "Goles marcados desde fuera del área rival.", category: "Goles y modelo" },
  "OwnGoals": { label: "Autogoles", def: "Goles en contra.", category: "Goles y modelo" },
  "Penalties": { label: "Penales pateados", def: "Penales que pateó el equipo/jugador.", category: "Goles y modelo" },
  "PenaltiesScored": { label: "Penales convertidos", def: "Penales convertidos en gol.", category: "Goles y modelo" },
  "Threat": { label: "Amenaza", def: "Índice compuesto de FIFA que mide qué tan peligrosas y frecuentes son las acciones ofensivas cerca del arco rival (remates, pases clave, conducciones al área). Más alto = ataque más punzante.", category: "Goles y modelo" },
  "XG": { label: "Goles esperados (xG)", def: "Probabilidad acumulada de gol según la calidad de cada remate (ubicación, ángulo, tipo de jugada, presión del defensor). Si remató mucho desde buen lugar, el xG sube aunque no haya convertido.", category: "Goles y modelo" },
  "AttemptAtGoal": { label: "Remates", def: "Remates totales (a puerta + afuera + bloqueados).", category: "Remates" },
  "AttemptAtGoalAgainst": { label: "Remates recibidos", def: "Remates que le tiró el rival — la misma foto pero mirada en defensa.", category: "Remates" },
  "AttemptAtGoalAgainstOnTarget": { label: "Remates rivales a puerta", def: "De los remates que recibió, cuántos iban a puerta.", category: "Remates" },
  "AttemptAtGoalBlocked": { label: "Remates bloqueados", def: "Remates que un defensor tapó antes de llegar al arco.", category: "Remates" },
  "AttemptAtGoalFromBallProgression": { label: "Remates de jugada armada", def: "Remates que nacen de una jugada de progresión (pase o conducción que avanza el ataque), no de pelota parada.", category: "Remates" },
  "AttemptAtGoalFromCorner": { label: "Remates de córner", def: "Remates que salen directo de un córner.", category: "Remates" },
  "AttemptAtGoalFromCross": { label: "Remates de centro", def: "Remates que salen de un centro desde banda.", category: "Remates" },
  "AttemptAtGoalFromFreeKicks": { label: "Remates de tiro libre", def: "Remates que salen de un tiro libre.", category: "Remates" },
  "AttemptAtGoalFromOther": { label: "Remates de otro origen", def: "Remates que no encajan en ninguna de las demás categorías de jugada.", category: "Remates" },
  "AttemptAtGoalFromPass": { label: "Remates de pase en juego", def: "Remates que nacen de un pase en juego abierto (no centro, no pelota parada).", category: "Remates" },
  "AttemptAtGoalFromPenalty": { label: "Remates de penal", def: "Remates ejecutados de penal.", category: "Remates" },
  "AttemptAtGoalFromRebound": { label: "Remates de rebote", def: "Remates de rechace, en una segunda jugada tras un remate o atajada previa.", category: "Remates" },
  "AttemptAtGoalInsideThePenaltyArea": { label: "Remates dentro del área", def: "Remates ejecutados desde dentro del área rival.", category: "Remates" },
  "AttemptAtGoalInsideThePenaltyAreaOnTarget": { label: "Remates dentro del área a puerta", def: "De los remates dentro del área, cuántos fueron a puerta.", category: "Remates" },
  "AttemptAtGoalOffTarget": { label: "Remates desviados", def: "Remates que se van afuera, sin exigir al arquero.", category: "Remates" },
  "AttemptAtGoalOnTarget": { label: "Remates a puerta", def: "Remates que van entre los tres palos — exigen atajada o son gol.", category: "Remates" },
  "AttemptAtGoalOutsideThePenaltyArea": { label: "Remates de media distancia", def: "Remates ejecutados desde fuera del área rival.", category: "Remates" },
  "AttemptAtGoalOutsideThePenaltyAreaOnTarget": { label: "Remates de media distancia a puerta", def: "De los remates desde fuera del área, cuántos fueron a puerta.", category: "Remates" },
  "HeadedAttemptAtGoal": { label: "Remates de cabeza", def: "Remates ejecutados de cabeza.", category: "Remates" },
  "NumberOfShotEndingSequences": { label: "Jugadas que terminan en remate", def: "Cantidad de jugadas de ataque (posesiones) que terminaron en un remate — mide cuántas veces el equipo llegó de verdad, no solo cuántos remates sueltos dio.", category: "Remates" },
  "Assists": { label: "Asistencias", def: "El pase inmediatamente anterior a un gol.", category: "Pases y distribución" },
  "AttemptedSwitchesOfPlay": { label: "Cambios de orientación intentados", def: "Pases largos que mueven el juego de un costado de la cancha al otro, buscando desequilibrar al rival.", category: "Pases y distribución" },
  "CompletedSwitchesOfPlay": { label: "Cambios de orientación logrados", def: "De esos cambios de orientación, los que llegaron limpio a destino.", category: "Pases y distribución" },
  "Corners": { label: "Córners", def: "Córners sacados.", category: "Pases y distribución" },
  "Crosses": { label: "Centros", def: "Centros intentados desde banda hacia el área.", category: "Pases y distribución" },
  "CrossesCompleted": { label: "Centros completados", def: "Centros que encontraron a un compañero.", category: "Pases y distribución" },
  "DirectFreeKicks": { label: "Tiros libres directos", def: "Tiros libres que se pueden rematar al arco sin que la toque otro jugador antes.", category: "Pases y distribución" },
  "DistributionsCompletedUnderPressure": { label: "Pases logrados bajo presión", def: "Pases o distribuciones que llegaron a destino pese a tener un rival encima presionando.", category: "Pases y distribución" },
  "DistributionsUnderPressure": { label: "Pases intentados bajo presión", def: "Total de pases o distribuciones ejecutados con un rival presionando (lleguen o no).", category: "Pases y distribución" },
  "FreeKicks": { label: "Tiros libres", def: "Tiros libres totales, directos e indirectos.", category: "Pases y distribución" },
  "IndirectFreeKicks": { label: "Tiros libres indirectos", def: "Tiros libres que necesitan que la toque otro jugador antes de poder ir directo a gol.", category: "Pases y distribución" },
  "Passes": { label: "Pases", def: "Pases intentados.", category: "Pases y distribución" },
  "PassesCompleted": { label: "Pases completados", def: "Pases que llegaron a un compañero.", category: "Pases y distribución" },
  "ThrowIns": { label: "Saques de banda", def: "Saques de banda ejecutados.", category: "Pases y distribución" },
  "AttemptedBallProgressions": { label: "Progresiones de balón intentadas", def: "Pases o conducciones que buscan avanzar el balón de forma significativa hacia el arco rival.", category: "Progresión y rupturas de línea" },
  "CompletedBallProgressions": { label: "Progresiones de balón logradas", def: "De esas, las que avanzaron el balón de forma efectiva.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttempted": { label: "Rupturas de línea intentadas (total)", def: "Intentos de superar cualquier línea de presión rival — el conteo general de la familia de \"rupturas de línea\".", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedAllLines": { label: "Ruptura de TODAS las líneas intentada", def: "Intentos de romper de una sola jugada la defensa, el medio y el ataque rival juntos — el tipo de ruptura más difícil y valiosa.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedAttackingAndMidfieldLine": { label: "Ruptura de ataque+medio intentada", def: "Intentos de romper a la vez la línea de ataque y la de medio del rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedAttackingLine": { label: "Ruptura de línea de ataque intentada", def: "Intentos que incluyen romper la línea de ataque rival (sola o combinada con otra).", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedAttackingLineCompleted": { label: "Ruptura de línea de ataque lograda", def: "De esos intentos, los que sí superaron la línea de ataque rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedAttackingLineCompletedOnly": { label: "Ruptura SOLO de línea de ataque lograda", def: "Rupturas logradas de ÚNICAMENTE la línea de ataque rival, sin sumar otra línea a la vez.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedAttackingLineOnly": { label: "Ruptura SOLO de línea de ataque intentada", def: "Intentos dirigidos únicamente a romper la línea de ataque rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedCompleted": { label: "Rupturas de línea logradas (total)", def: "Total de intentos de ruptura, en cualquier combinación de líneas, que terminaron exitosos.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedDefensiveLine": { label: "Ruptura de línea defensiva intentada", def: "Intentos que incluyen romper la línea defensiva rival — la más profunda, la que deja mano a mano con el arquero.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedDefensiveLineCompleted": { label: "Ruptura de línea defensiva lograda", def: "De esos intentos, los que sí superaron la línea defensiva rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedDefensiveLineCompletedOnly": { label: "Ruptura SOLO de línea defensiva lograda", def: "Rupturas logradas de ÚNICAMENTE la línea defensiva rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedDefensiveLineOnly": { label: "Ruptura SOLO de línea defensiva intentada", def: "Intentos dirigidos únicamente a romper la línea defensiva rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedMidfieldAndDefensiveLine": { label: "Ruptura de medio+defensa intentada", def: "Intentos de romper a la vez la línea de medio y la defensiva rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedMidfieldLine": { label: "Ruptura de línea de medio intentada", def: "Intentos que incluyen romper la línea de medio rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedMidfieldLineCompleted": { label: "Ruptura de línea de medio lograda", def: "De esos intentos, los que sí superaron la línea de medio rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedMidfieldLineCompletedOnly": { label: "Ruptura SOLO de línea de medio lograda", def: "Rupturas logradas de ÚNICAMENTE la línea de medio rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedMidfieldLineOnly": { label: "Ruptura SOLO de línea de medio intentada", def: "Intentos dirigidos únicamente a romper la línea de medio rival.", category: "Progresión y rupturas de línea" },
  "LinebreaksAttemptedUnderPressure": { label: "Rupturas de línea intentadas bajo presión", def: "Intentos de ruptura de línea ejecutados con el jugador presionado en el momento.", category: "Progresión y rupturas de línea" },
  "LinebreaksCompletedAllLines": { label: "Ruptura de TODAS las líneas lograda", def: "Veces que el equipo superó defensa+medio+ataque rival en una sola jugada — la progresión más letal que mide FIFA.", category: "Progresión y rupturas de línea" },
  "LinebreaksCompletedAttackingAndMidfieldLine": { label: "Ruptura de ataque+medio lograda", def: "Rupturas completadas de la línea de ataque y de medio a la vez.", category: "Progresión y rupturas de línea" },
  "LinebreaksCompletedMidfieldAndDefensiveLine": { label: "Ruptura de medio+defensa lograda", def: "Rupturas completadas de la línea de medio y la defensiva a la vez.", category: "Progresión y rupturas de línea" },
  "LinebreaksCompletedUnderPressure": { label: "Rupturas de línea logradas bajo presión", def: "Rupturas de línea completadas pese a estar el jugador presionado — mide calidad bajo estrés.", category: "Progresión y rupturas de línea" },
  "FinalThirdEntriesReceptionCentralChannel": { label: "Recepciones en último tercio (centro)", def: "Recepciones de balón en el último tercio de cancha, por el carril central.", category: "Territorio y recepción" },
  "FinalThirdEntriesReceptionInsideLeftChannel": { label: "Recepciones en último tercio (medio-izquierda)", def: "Recepciones en el último tercio, por el carril interior izquierdo (entre el centro y la banda).", category: "Territorio y recepción" },
  "FinalThirdEntriesReceptionInsideRightChannel": { label: "Recepciones en último tercio (medio-derecha)", def: "Recepciones en el último tercio, por el carril interior derecho.", category: "Territorio y recepción" },
  "FinalThirdEntriesReceptionLeftChannel": { label: "Recepciones en último tercio (banda izq.)", def: "Recepciones en el último tercio, por la banda izquierda.", category: "Territorio y recepción" },
  "FinalThirdEntriesReceptionRightChannel": { label: "Recepciones en último tercio (banda der.)", def: "Recepciones en el último tercio, por la banda derecha.", category: "Territorio y recepción" },
  "FinalThirdPitchControl": { label: "Control del último tercio", def: "Porcentaje del último tercio de cancha (la zona más cerca del arco rival) que el equipo domina territorialmente.", category: "Territorio y recepción" },
  "OffersToReceiveInBehind": { label: "Desmarques a la espalda", def: "Movimientos buscando recibir a la espalda de la última línea rival.", category: "Territorio y recepción" },
  "OffersToReceiveInBetween": { label: "Desmarques entre líneas", def: "Movimientos buscando recibir en el espacio entre líneas rivales (el clásico \"medio espacio\").", category: "Territorio y recepción" },
  "OffersToReceiveInFront": { label: "Desmarques de cara", def: "Movimientos buscando recibir de cara, por delante de la presión rival más cercana.", category: "Territorio y recepción" },
  "OffersToReceiveInside": { label: "Desmarques hacia adentro", def: "Movimientos ofreciéndose a recibir hacia el interior de la cancha.", category: "Territorio y recepción" },
  "OffersToReceiveOutside": { label: "Desmarques hacia afuera", def: "Movimientos ofreciéndose a recibir hacia la banda.", category: "Territorio y recepción" },
  "OffersToReceiveTotal": { label: "Desmarques totales", def: "Total de movimientos ofreciéndose a recibir, sumando todos los tipos.", category: "Territorio y recepción" },
  "PitchControl": { label: "Control de cancha", def: "Porcentaje de la cancha completa que el equipo domina territorialmente en promedio durante el partido.", category: "Territorio y recepción" },
  "Possession": { label: "Posesión", def: "Porcentaje de tiempo con el balón.", category: "Territorio y recepción" },
  "ReceivedOffersToReceive": { label: "Desmarques que terminaron en recepción", def: "De todos los movimientos ofreciéndose a recibir, cuántos terminaron en una recepción real de balón.", category: "Territorio y recepción" },
  "ReceptionsBetweenMidfieldAndDefensiveLine": { label: "Recepciones entre medio y defensa rival", def: "Recepciones de balón en el espacio entre la línea de medio y la defensiva del rival — zona clave de progresión.", category: "Territorio y recepción" },
  "ReceptionsInBehind": { label: "Recepciones a la espalda", def: "Recepciones de balón a la espalda de la última línea rival.", category: "Territorio y recepción" },
  "ReceptionsUnderDirectPressure": { label: "Recepciones con marca directa", def: "Recepciones con un rival encima marcando directamente al que recibe.", category: "Territorio y recepción" },
  "ReceptionsUnderIndirectPressure": { label: "Recepciones con presión cercana", def: "Recepciones con presión rival cerca, pero no directamente sobre el que recibe.", category: "Territorio y recepción" },
  "ReceptionsUnderNoPressure": { label: "Recepciones sin presión", def: "Recepciones sin ningún rival presionando.", category: "Territorio y recepción" },
  "ReceptionsUnderPressure": { label: "Recepciones bajo presión (total)", def: "Total de recepciones con algún tipo de presión encima, directa o indirecta.", category: "Territorio y recepción" },
  "BallRecoveryTime": { label: "Tiempo de recuperación", def: "Segundos promedio que tarda el equipo en recuperar el balón después de perderlo — qué tan rápido reacciona a la pérdida.", category: "Defensa y presión" },
  "DefensivePressuresApplied": { label: "Presiones aplicadas", def: "Presiones defensivas ejecutadas sobre el rival que tiene el balón.", category: "Defensa y presión" },
  "DirectDefensivePressuresApplied": { label: "Presiones directas aplicadas", def: "De esas presiones, las que fueron directamente sobre el jugador con el balón, no de acompañamiento.", category: "Defensa y presión" },
  "ForcedTurnovers": { label: "Pérdidas provocadas", def: "Pérdidas de balón del rival provocadas por una acción defensiva del equipo, no un error propio sin presión.", category: "Defensa y presión" },
  "NumberOfInvolvements": { label: "Involucramientos", def: "Cantidad de acciones donde el jugador/equipo participó activamente (toques, pases, remates, presiones) — mide qué tan metido estuvo en el juego.", category: "Defensa y presión" },
  "NumberOfPossessionSequences": { label: "Secuencias de posesión", def: "Cantidad de tramos continuos con el balón que tuvo el equipo.", category: "Defensa y presión" },
  "TakeOnsCompleted": { label: "Regates completados", def: "Gambetas/regates ganados en el uno contra uno.", category: "Defensa y presión" },
  "AvgSpeed": { label: "Velocidad promedio", def: "Velocidad promedio de desplazamiento durante el partido, en km/h.", category: "Físico" },
  "DistanceHighSpeedRunning": { label: "Distancia a alta velocidad", def: "Kilómetros recorridos corriendo a alta velocidad, por debajo del umbral de sprint.", category: "Físico" },
  "DistanceHighSpeedSprinting": { label: "Distancia en sprint alto", def: "Kilómetros recorridos en sprint a máxima intensidad.", category: "Físico" },
  "DistanceJogging": { label: "Distancia trotando", def: "Kilómetros recorridos a ritmo bajo (trote).", category: "Físico" },
  "DistanceLowSpeedSprinting": { label: "Distancia en sprint bajo", def: "Kilómetros recorridos en sprints de intensidad más moderada.", category: "Físico" },
  "DistanceWalking": { label: "Distancia caminando", def: "Kilómetros recorridos caminando.", category: "Físico" },
  "SpeedRuns": { label: "Arrancadas de velocidad", def: "Cantidad de carreras/arrancadas a velocidad significativa (conteo, no distancia).", category: "Físico" },
  "Sprints": { label: "Sprints", def: "Cantidad de sprints (arrancadas a máxima intensidad) realizados.", category: "Físico" },
  "TopSpeed": { label: "Velocidad punta", def: "Velocidad máxima alcanzada en el partido, en km/h.", category: "Físico" },
  "TotalDistance": { label: "Distancia total", def: "Kilómetros totales recorridos en el partido.", category: "Físico" },
  "PhaseAggregateAttackingTransition": { label: "Transición ofensiva", def: "Momento inmediato tras recuperar el balón, antes de organizarse en ataque posicional.", category: "Fases tácticas" },
  "PhaseAggregateBuildUpOpposed": { label: "Salida de balón presionada", def: "Construcción desde el fondo con el rival presionando activamente.", category: "Fases tácticas" },
  "PhaseAggregateBuildUpUnopposed": { label: "Salida de balón libre", def: "Construcción desde el fondo sin presión rival relevante, con espacio y tiempo.", category: "Fases tácticas" },
  "PhaseAggregateCounterattack": { label: "Contraataque", def: "Ataque rápido y directo tras robar el balón, buscando explotar al rival desorganizado.", category: "Fases tácticas" },
  "PhaseAggregateCounterPress": { label: "Contrapresión", def: "Presión inmediata para recuperar el balón apenas se pierde, antes de replegarse (\"gegenpressing\").", category: "Fases tácticas" },
  "PhaseAggregateDefensiveTransition": { label: "Transición defensiva", def: "Momento inmediato tras perder el balón, antes de reorganizarse en bloque defensivo.", category: "Fases tácticas" },
  "PhaseAggregateFinalThird": { label: "Juego en último tercio", def: "Ataque posicional ya instalado cerca del arco rival.", category: "Fases tácticas" },
  "PhaseAggregateHighBlock": { label: "Bloque alto", def: "La línea defensiva del equipo se ubica lejos de su propio arco.", category: "Fases tácticas" },
  "PhaseAggregateHighPress": { label: "Presión alta", def: "El equipo presiona la salida de balón rival cerca del arco de este.", category: "Fases tácticas" },
  "PhaseAggregateLongBall": { label: "Juego directo", def: "Balón largo saltando líneas intermedias.", category: "Fases tácticas" },
  "PhaseAggregateLowBlock": { label: "Bloque bajo", def: "La línea defensiva se repliega cerca de su propio arco.", category: "Fases tácticas" },
  "PhaseAggregateLowPress": { label: "Presión baja", def: "El equipo espera y presiona recién en su propio campo.", category: "Fases tácticas" },
  "PhaseAggregateMidBlock": { label: "Bloque medio", def: "Línea defensiva ubicada a media altura de cancha.", category: "Fases tácticas" },
  "PhaseAggregateMidPress": { label: "Presión media", def: "La presión arranca en la zona media de la cancha.", category: "Fases tácticas" },
  "PhaseAggregateProgression": { label: "Fase de progresión", def: "Avance general del ataque hacia el arco rival, sin estar aún en el último tercio.", category: "Fases tácticas" },
  "PhaseAggregateRecovery": { label: "Fase de recuperación", def: "El instante/acción de recuperar la posesión del balón.", category: "Fases tácticas" },
  "PhaseAggregateSetPieces": { label: "Pelota parada", def: "Córners, tiros libres, laterales y penales.", category: "Fases tácticas" },
  "GoalkeeperDefensiveActionsInsidePenaltyArea": { label: "Acciones del arquero en su área", def: "Atajadas, achiques y despejes del arquero dentro de su propia área.", category: "Portería" },
  "GoalkeeperDefensiveActionsOutsidePenaltyArea": { label: "Acciones del arquero fuera del área", def: "Intervenciones del arquero fuera de su área, achicando espacio detrás de la defensa (arquero \"líbero\").", category: "Portería" },
  "GoalkeeperSavePercentage": { label: "% de atajadas", def: "Porcentaje de remates a puerta que el arquero logró atajar.", category: "Portería" },
  "GoalkeeperSaves": { label: "Atajadas", def: "Atajadas del arquero.", category: "Portería" },
  "GoalkeeperSavesOnTarget": { label: "Remates a puerta atajados", def: "De los remates a puerta que enfrentó, cuántos atajó — la base para calcular el % de atajadas.", category: "Portería" },
  "GoalKicks": { label: "Saques de arco", def: "Saques de arco ejecutados.", category: "Portería" },
  "DirectRedCards": { label: "Rojas directas", def: "Expulsiones por roja directa, sin amarilla previa.", category: "Disciplina" },
  "FoulsAgainst": { label: "Faltas cometidas", def: "Faltas cometidas por el equipo.", category: "Disciplina" },
  "FoulsFor": { label: "Faltas recibidas", def: "Faltas cometidas por el rival contra el equipo.", category: "Disciplina" },
  "IndirectRedCards": { label: "Rojas por doble amarilla", def: "Expulsiones por doble tarjeta amarilla.", category: "Disciplina" },
  "Offsides": { label: "Fueras de juego", def: "Fueras de juego marcados.", category: "Disciplina" },
  "RedCards": { label: "Expulsiones (total)", def: "Total de expulsiones, directas más doble amarilla.", category: "Disciplina" },
  "YellowCards": { label: "Amarillas", def: "Tarjetas amarillas.", category: "Disciplina" },
  "MatchesPlayed": { label: "Partidos jugados", def: "Cantidad de partidos jugados (base para promedios por partido).", category: "Otros / meta" },
  "SubstitutionsIn": { label: "Ingresos", def: "Jugadores que ingresaron en cambios.", category: "Otros / meta" },
  "SubstitutionsOut": { label: "Salidas", def: "Jugadores que salieron en cambios.", category: "Otros / meta" },
  "TimePlayed": { label: "Minutos jugados", def: "Minutos jugados.", category: "Otros / meta" },
};

for (const [name, kws] of Object.entries(KEYWORD_OVERRIDES)) {
  if (STAT_GLOSSARY[name]) STAT_GLOSSARY[name].keywords = kws;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export interface GlossaryMatch { name: string; label: string; def: string; category: string; score: number }

const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "de", "del", "que", "y", "en", "por",
  "para", "con", "cuanto", "cuantos", "cuanta", "cuantas", "cual", "cuales",
  "tanto", "tanta", "tantos", "tantas", "es", "fue", "tuvo", "tuvieron",
  "the", "of", "a", "how", "many",
]);
const words = (s: string) => s.split(/[^a-z0-9]+/).filter((w) => w && !STOPWORDS.has(w));
// PascalCase "DefensivePressuresApplied" -> ["defensive","pressures","applied"]
const splitPascal = (s: string) => norm(s).replace(/([a-z])([A-Z])/g, "$1 $2");

/** ¿Comparten raíz? Compara prefijo común para tolerar conjugaciones/plurales en
 * español ("presionaron" vs "presiones" sí matchea — comparten "presion..."; "corrio"
 * vs "recorridos" NO matchea por el prefijo derivativo "re-" — para esos casos puntuales
 * está `KEYWORD_OVERRIDES` arriba). Exige que el prefijo compartido cubra al menos
 * el 60% de la palabra más corta. */
function sharesStem(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return false;
  let i = 0;
  while (i < minLen && a[i] === b[i]) i++;
  return i >= Math.max(4, Math.ceil(minLen * 0.6));
}

/** Busca en el glosario por texto libre en español (o el nombre crudo de FIFA).
 * Ranking por coincidencia de tokens (por raíz, tolera conjugaciones): frase exacta
 * de label > keyword curado > palabra de label > palabra de nombre crudo > palabra
 * de definición. Usar SIEMPRE que se necesite un stat de `stats_completas` cuyo
 * nombre exacto no se conoce — evita que el LLM adivine el PascalCase de FIFA
 * (mismo tipo de bug que ya causó thrashing con matchId, ver system-prompt.ts de Jano). */
export function searchGlossary(query: string, top = 5): GlossaryMatch[] {
  const q = norm(query);
  const qTokens = words(q);
  if (!qTokens.length) return [];
  const results: GlossaryMatch[] = [];
  for (const [name, e] of Object.entries(STAT_GLOSSARY)) {
    const label = norm(e.label);
    const labelWords = words(label);
    const defWords = words(norm(e.def));
    const nameWords = words(splitPascal(name));
    const keywordWords = (e.keywords ?? []).map(norm);
    let score = 0;
    if (label === q) score += 100;
    if (norm(name) === q.replace(/\s+/g, "")) score += 90;
    if (label.includes(q)) score += 30;
    for (const t of qTokens) {
      if (keywordWords.some((w) => sharesStem(w, t))) score += 8;
      if (labelWords.some((w) => sharesStem(w, t))) score += 6;
      if (nameWords.some((w) => sharesStem(w, t))) score += 3;
      if (defWords.some((w) => sharesStem(w, t))) score += 1;
    }
    if (score > 0) results.push({ name, label: e.label, def: e.def, category: e.category, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, top);
}

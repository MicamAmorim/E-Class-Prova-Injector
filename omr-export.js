(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EClassOmrExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const schema = 'eclass-omr-exam/1';
  const alternatives = ['A', 'B', 'C', 'D', 'E'];

  function friendlyClassName(value) {
    const name = String(value == null ? '' : value).trim();
    const match = /^EMERE0?(\d)M([A-Z])$/i.exec(name);
    return match ? Number(match[1]) + 'M' + match[2].toUpperCase() : name;
  }

  // A rota de matrículas usada na branch word pode retornar alunos vinculados
  // a uma ou várias turmas. Normalizamos somente os campos necessários ao OMR.
  function normalizeRoster(payload) {
    const rows = Array.isArray(payload) ? payload :
      (Array.isArray(payload?.data) ? payload.data :
       Array.isArray(payload?.data?.data) ? payload.data.data :
       Array.isArray(payload?.students) ? payload.students :
       Array.isArray(payload?.data?.students) ? payload.data.students : []);
    const result = new Map();
    for (const student of rows) {
      if (!student || typeof student !== 'object') continue;
      const id = student.student_id ?? student.aluno_id ??
        student.id ?? student.student?.id ?? student.aluno?.id;
      if (id == null || id === '') continue;
      const name = student.name || student.nome ||
        student.student?.name || student.student?.nome ||
        student.aluno?.nome || String(id);
      const groups = new Set();
      for (const raw of [student.group_id, student.classId, student.turma_id]) {
        if (raw != null && Number.isFinite(Number(raw)) && Number(raw)>0) groups.add(Number(raw));
      }
      const memberships = student.student_groups || student.turmas || [];
      for (const group of Array.isArray(memberships) ? memberships : []) {
        const gid = group?.turma_id ?? group?.group_id ?? group?.classId;
        if (gid != null && Number.isFinite(Number(gid)) && Number(gid)>0) groups.add(Number(gid));
      }
      for (const classId of groups) {
        result.set(classId + ':' + String(id), { classId, id: String(id), name: String(name) });
      }
    }
    return [...result.values()];
  }

  function fileNameForExam(title) {
    const base = String(title || 'prova')
      .replace(/[^\p{L}\p{N}._-]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 100) || 'prova';
    return base + '.eclass-omr.json';
  }

  function buildPackage(options) {
    const questions = Array.isArray(options.questions) ? options.questions : [];
    const objectives = questions.filter(q => q.type !== 'open');
    if (!objectives.length) throw new Error('A prova não possui questões objetivas para exportar.');
    const missing = objectives.filter(q =>
      !Number.isInteger(q.correct) ||
      q.correct < 0 ||
      q.correct >= alternatives.length ||
      !Array.isArray(q.choices) ||
      q.correct >= q.choices.length ||
      q.choices.length > alternatives.length
    );
    if (missing.length) {
      throw new Error('Gabarito ausente ou incompatível com alternativas A-E nas questões: ' +
        missing.map(q => q.number).join(', ') + '.');
    }
    const uniqueNumbers = new Set(questions.map(q => String(q.number)));
    if (uniqueNumbers.size !== questions.length) {
      throw new Error('Há números de questões repetidos; revise a prova antes da exportação.');
    }
    const ids = new Set((options.classIds || []).map(Number).filter(Number.isFinite));
    const classes = (options.classes || []).filter(c => ids.has(Number(c.id)));
    const students = Array.isArray(options.students) ? options.students : [];
    const chosenStudents = Array.isArray(options.selectedStudents) ? options.selectedStudents : [];
    const specificStudents = Boolean(options.specificStudents);
    if (specificStudents && !chosenStudents.length) {
      throw new Error('Marque os alunos específicos antes de exportar o gabarito.');
    }
    const allowedPairs = new Set(chosenStudents.map(s => Number(s.classId) + ':' + String(s.id)));
    const classRecords = [];
    for (const id of ids) {
      const cls = classes.find(c => Number(c.id) === id);
      const raw = cls ? cls.description || cls.descricao || cls.name : '';
      const roster = students.filter(s => Number(s.classId) === id);
      const byId = new Map();
      for (const student of roster) {
        const sid = String(student.id);
        if (!sid || (specificStudents && !allowedPairs.has(id + ':' + sid))) continue;
        byId.set(sid, {
          externalId: 'eclass-student:' + sid,
          name: String(student.name || sid)
        });
      }
      if (specificStudents) {
        for (const student of chosenStudents.filter(s => Number(s.classId) === id)) {
          const sid = String(student.id);
          if (!byId.has(sid)) byId.set(sid, {
            externalId: 'eclass-student:' + sid,
            name: sid
          });
        }
      }
      classRecords.push({
        externalId: 'eclass-class:' + id,
        eclassId: id,
        name: friendlyClassName(raw || String(id)),
        students: [...byId.values()]
      });
    }

    const withRoster = classRecords.some(c => c.students.length > 0);
    return {
      schema, version: 1, source: 'E-Class Prova Injector',
      exportedAt: String(options.exportedAt || new Date().toISOString()),
      externalId: String(options.externalId || ''),
      exam: {
        title: String(options.title || '').trim() || 'Prova sem título',
        subject: String(options.subject || '').trim() || 'Geral',
        mode: withRoster ? 'student' : 'general',
        questions: questions.map(q => q.type === 'open'
          ? {
              number: q.number, type: 'open',
              response: {
                format: q.response?.format || 'lines',
                lines: Number(q.response?.lines || 10)
              }
            }
          : { number: q.number, type: 'objective', answer: alternatives[q.correct] }),
        omr: {
          alternatives: [...alternatives],
          objectiveQuestionNumbers: objectives.map(q => q.number),
          answerKey: objectives.map(q => alternatives[q.correct])
        },
        classes: withRoster ? classRecords : []
      }
    };
  }

  return { schema, friendlyClassName, fileNameForExam, normalizeRoster, buildPackage };
});

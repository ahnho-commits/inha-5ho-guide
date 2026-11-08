'use strict';
// Every sentence the indoor guide shows lives here, one table per language.
// Other languages get added as new tables with the same keys; {name} placeholders are filled by t().

const STR = {
  ko: {
    wing_E: '5동', wing_N: '5북', wing_W: '5서', wing_S: '5남',
    floor: '{f}층', floor_b1: '지하 1층', floor_tower: '탑 {f}층',

    room_label: '강의실 번호',
    room_ph: '예: 5E 107A, 5남 335',
    room_go: '이 호실로 안내',
    room_unknown: '번호를 읽지 못했어요. 5E 107A, 5동 107A, 5남 335 같은 형식으로 적어 주세요.',
    room_split_tag: '{base}호를 나눈 방',
    room_split_note: '{base}호는 {list}로 나뉘어 있어요. 어느 방인지 골라 주세요.',
    room_number_only: '{room}호는 여러 동에 있어요. 어느 동인지 골라 주세요.',
    room_other_building: '5호관만 안내해요. {label}로 찾았어요.',
    room_missing: '{label}: 지도 데이터(2022)에 없는 번호예요. 가장 가까운 {near} 쪽으로 안내할게요.',
    room_missing_none: '{label}: 지도 데이터(2022)에 없는 번호예요.',
    room_decode: '{wing} · {f}층 · {room}호',
    quick_b1: '지하 동아리방',
    quick_b1_sub: '5동 지하 복도',
    quick_tower: '5동탑 동아리방',
    quick_tower_sub: '6~10층',

    inside_btn: '이미 5호관 안에 있어요',
    inside_title: '지금 어디에 있어요?',
    inside_near: '가까운 문 위 호실 번호',
    inside_near_ph: '예: 5동 211',
    inside_or: '번호가 안 보이면 층과 동을 고르세요',
    inside_start: '여기서 출발',

    nw_toggle: '5북↔5서 통로 이용 (현장 확인 전)',
    indoor_go: '건물 안으로 →',
    arrived_banner: '{entrance}에 도착했어요. 이제 건물 안 안내예요.',
    indoor_title: '{from} → {to}',
    indoor_sub: '안내 {n}단계 · 층 이동 {floors}번',

    step_enter: '{entrance}로 들어오세요',
    step_enter_sub: '들어오면 바로 {place} 쪽이에요.',
    step_walk: '{wing} 복도를 따라 걸어가세요',
    step_walk_sub: '{dir} 쪽으로, 호실 {count}개를 지나 {to}까지',
    step_walk_near: '{to}까지 몇 걸음이에요',
    dir_up: '번호가 커지는',
    dir_down: '번호가 작아지는',
    step_checks: '지나갈 호실 {list}',
    step_wrong: '{room}호가 보이면 반대 방향',
    step_neighbors: '옆방 {list}',
    step_turn: '모서리에서 {wing_ro} 넘어가세요',
    step_turn_sub: '같은 층 복도가 이어져요. {to}까지 가세요.',
    step_stairs: '{stair_ro} {to}',
    step_stairs_sub: '{from}에서 {to}까지 {dir}',
    go_up: '올라가세요',
    go_down: '내려가세요',
    step_lift: '엘리베이터(또는 옆 계단)로 {to}',
    step_x: 'X자 계단으로 5남1↔5남2를 넘어가세요',
    step_x_sub: '같은 층이어도 반 층 올라갔다가 다시 내려가야 해요.',
    step_b1_walk: '5동 지하 복도를 따라가세요',
    step_b1_walk_sub: '긴 복도 양쪽이 동아리방이에요. 문마다 동아리 이름이 붙어 있어요.',
    step_tower_in: '엘리베이터 앞 출입구로 들어가 탑 계단으로',
    step_tower_in_sub: '맨 위 인하복싱, 아래로 9F~6F 동아리가 적힌 안내판이 있어요.',
    step_arrive: '{to} 도착',
    step_arrive_sub: '문 위 번호판이 {to}인지 확인하세요.',
    step_arrive_place: '이름표를 확인하세요.',

    stair_lift: '엘리베이터 쪽 계단',
    data_note: '건물 안 배치는 2022년 학생 프로젝트 데이터를 단순화한 그림이에요. 실제와 다를 수 있어요.',
  },
};

// Korean picks 로/으로 by the last syllable (ㄹ-final and vowel-final take 로).
function ro(word) {
  const ch = word.trim().slice(-1);
  if (/\d/.test(ch)) return word + ('036'.includes(ch) ? '으로' : '로');   // 영·삼·육 take 으로
  const code = ch.charCodeAt(0) - 0xAC00;
  const jong = code >= 0 && code < 11172 ? code % 28 : 0;
  return word + (jong === 0 || jong === 8 ? '로' : '으로');
}

let LANG = 'ko';
function t(key, vars = {}) {
  const s = (STR[LANG] && STR[LANG][key]) ?? STR.ko[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/* 디자인 검토용 고정 데이터. 서버 및 실제 고객 정보와 연결되지 않습니다. */
window.OpenStudyData = {
  today: '2026-10-17',
  branches: [{id:'gangnam', name:'강남점', short:'강남', seats:80, used:54}, {id:'seongsu', name:'성수점', short:'성수', seats:60, used:39}],
  people: [
    {id:'owner', name:'김서연', role:'사장님', branch:'all', initials:'서', color:'olive', email:'seoyeon@openstudy.demo', shift:'전체 지점 운영'},
    {id:'minji', name:'이민지', role:'매니저', branch:'gangnam', initials:'민', color:'peach', email:'minji@openstudy.demo', shift:'09:00 – 18:00'},
    {id:'junho', name:'박준호', role:'직원', branch:'gangnam', initials:'준', color:'blue', email:'junho@openstudy.demo', shift:'14:00 – 22:00'},
    {id:'yujin', name:'최유진', role:'매니저', branch:'seongsu', initials:'유', color:'lavender', email:'yujin@openstudy.demo', shift:'09:00 – 18:00'},
    {id:'doyun', name:'정도윤', role:'직원', branch:'seongsu', initials:'도', color:'olive', email:'doyun@openstudy.demo', shift:'16:00 – 23:00'}
  ],
  tasks: [
    {id:1,title:'스터디룸 A 냉방 상태 확인',desc:'오후 예약 전 냉방 온도와 필터 상태를 확인해 주세요. 문제가 있으면 시설 채널에 공유해 주세요.',branch:'gangnam',assignee:'minji',status:'진행 중',priority:'높음',due:'2026-10-17',category:'시설 점검',checks:[{text:'냉방 온도 확인',done:true},{text:'필터 상태 확인',done:false},{text:'운영 채널에 결과 보고',done:false}]},
    {id:2,title:'오후 근무 인수인계 전달',desc:'잔여 업무와 고객 요청 사항을 정리해 다음 근무자에게 전달합니다.',branch:'gangnam',assignee:'junho',status:'할 일',priority:'보통',due:'2026-10-17',category:'인수인계',checks:[{text:'미처리 문의 확인',done:false},{text:'교대 내용 공유',done:false}]},
    {id:3,title:'이용권 만료 예정 회원 안내',desc:'3일 이내 이용권이 만료되는 회원에게 연장 안내를 준비합니다.',branch:'seongsu',assignee:'yujin',status:'할 일',priority:'보통',due:'2026-10-17',category:'회원 관리',checks:[{text:'대상 회원 확인',done:false}]},
    {id:4,title:'집중존 조명 및 콘센트 점검',desc:'집중존 전 좌석의 조명과 충전 콘센트를 점검합니다.',branch:'gangnam',assignee:'minji',status:'완료',priority:'보통',due:'2026-10-17',category:'정기 점검',checks:[{text:'조명 점검',done:true},{text:'콘센트 점검',done:true}]},
    {id:5,title:'주간 소모품 재고 확인',desc:'휴지, 종이컵, 커피 원두 재고를 확인하고 필요 수량을 정리합니다.',branch:'seongsu',assignee:'doyun',status:'진행 중',priority:'낮음',due:'2026-10-18',category:'소모품',checks:[{text:'재고 수량 확인',done:true},{text:'발주 요청 정리',done:false}]},
    {id:6,title:'오픈 전 공용 공간 청소',desc:'라운지와 공용 데스크 청소를 완료합니다.',branch:'gangnam',assignee:'junho',status:'완료',priority:'보통',due:'2026-10-17',category:'청소',checks:[{text:'라운지 청소',done:true}]}
  ],
  channels: [
    {id:'general',name:'전체-공지',description:'모든 지점의 중요한 소식을 함께 확인해요.',branch:'all',unread:1},
    {id:'gangnam',name:'강남점-운영',description:'강남점의 하루, 업무와 인수인계를 공유하는 공간',branch:'gangnam',unread:3},
    {id:'seongsu',name:'성수점-운영',description:'성수점 운영 소식과 교대 인수인계',branch:'seongsu',unread:2},
    {id:'facilities',name:'시설-점검',description:'시설 이상, 점검 결과와 소모품 요청을 공유해요.',branch:'all',unread:0},
    {id:'ideas',name:'함께-나눠요',description:'더 좋은 공간을 위한 작은 아이디어',branch:'all',unread:0}
  ],
  messages: [
    {id:1,channel:'gangnam',author:'owner',time:'09:00',text:'좋은 아침이에요! 오늘도 편안하게 집중할 수 있는 공간을 함께 만들어 봐요. 🌿',replies:[]},
    {id:2,channel:'gangnam',author:'minji',time:'09:12',text:'오픈 점검 완료했습니다. 집중존 조명과 콘센트 모두 정상이에요. 오늘 스터디룸 예약은 오후 2시부터입니다.',replies:[{author:'owner',text:'확인했어요. 꼼꼼한 점검 감사합니다!',time:'09:15'}]},
    {id:3,channel:'gangnam',author:'owner',time:'09:24',text:'스터디룸 냉방 점검 부탁드려요. 처리 후 이곳에 결과를 남겨 주세요.',taskId:1,replies:[]},
    {id:4,channel:'gangnam',author:'junho',time:'09:32',text:'오후 출근 후 인수인계 확인하겠습니다. 종이컵은 창고 두 번째 선반에 보충해 두었어요.',replies:[]},
    {id:5,channel:'general',author:'owner',time:'08:40',text:'이번 주 토요일은 정기 소독일입니다. 지점별 운영 공지와 체크리스트를 확인해 주세요.',replies:[]},
    {id:6,channel:'seongsu',author:'yujin',time:'09:20',text:'성수점 정상 오픈했습니다. 오후에는 소모품 재고를 확인할 예정입니다.',replies:[]},
    {id:7,channel:'facilities',author:'minji',time:'09:30',text:'강남점 스터디룸 A 냉방 상태를 확인 중입니다. 결과는 점검 업무에 기록할게요.',replies:[]},
    {id:8,channel:'dm-minji',author:'minji',time:'09:35',text:'사장님, 오늘 점검 업무 확인했어요. 완료하면 운영 채널에 보고드리겠습니다.',replies:[]}
  ],
  members: [
    {id:1,name:'김지우',phone:'010-••••-2104',branch:'gangnam',pass:'시간권 100시간',remaining:'42시간 30분',expires:'2026-11-12',status:'이용 중',seat:'A-12'},
    {id:2,name:'이서준',phone:'010-••••-4832',branch:'gangnam',pass:'기간권 4주',remaining:'2일',expires:'2026-10-19',status:'만료 예정',seat:'B-03'},
    {id:3,name:'박하린',phone:'010-••••-9071',branch:'seongsu',pass:'기간권 4주',remaining:'18일',expires:'2026-11-04',status:'이용 중',seat:'A-08'},
    {id:4,name:'최도현',phone:'010-••••-1528',branch:'gangnam',pass:'시간권 50시간',remaining:'18시간',expires:'2026-11-22',status:'이용 중',seat:'—'},
    {id:5,name:'정수빈',phone:'010-••••-6430',branch:'seongsu',pass:'기간권 2주',remaining:'1일',expires:'2026-10-18',status:'만료 예정',seat:'B-11'},
    {id:6,name:'한유나',phone:'010-••••-3209',branch:'gangnam',pass:'당일권',remaining:'0시간',expires:'2026-10-16',status:'만료',seat:'—'}
  ],
  reservations: [
    {id:1,member:'김지우',branch:'gangnam',space:'스터디룸 A',date:'2026-10-17',time:'14:00 – 16:00',count:'4명',status:'예약 확정'},
    {id:2,member:'최도현',branch:'gangnam',space:'스터디룸 B',date:'2026-10-17',time:'16:00 – 18:00',count:'2명',status:'예약 확정'},
    {id:3,member:'박하린',branch:'seongsu',space:'스터디룸 A',date:'2026-10-17',time:'10:00 – 12:00',count:'3명',status:'이용 완료'},
    {id:4,member:'이서준',branch:'gangnam',space:'고정석 B-03',date:'2026-10-18',time:'09:00 – 22:00',count:'1명',status:'예약 확정'},
    {id:5,member:'정수빈',branch:'seongsu',space:'스터디룸 B',date:'2026-10-20',time:'13:00 – 15:00',count:'4명',status:'취소'}
  ],
  facilities: [
    {id:1,title:'스터디룸 A 냉방 점검',branch:'gangnam',category:'시설 이상',assignee:'minji',status:'진행 중',desc:'설정 온도 대비 실내 온도가 높다는 문의가 접수되었습니다.'},
    {id:2,title:'라운지 종이컵 보충',branch:'gangnam',category:'소모품',assignee:'junho',status:'완료',desc:'종이컵 2줄 보충 완료.'},
    {id:3,title:'집중존 저녁 청소',branch:'seongsu',category:'청소',assignee:'doyun',status:'할 일',desc:'이용이 적은 구역부터 순서대로 청소해 주세요.'},
    {id:4,title:'정수기 필터 정기 교체',branch:'seongsu',category:'정기 점검',assignee:'yujin',status:'할 일',desc:'필터 교체 후 점검 스티커의 날짜를 업데이트합니다.'}
  ],
  inquiries: [
    {id:1,title:'스터디룸 온도가 조금 높아요',member:'김지우',branch:'gangnam',category:'시설 문의',assignee:'minji',status:'진행 중',desc:'오늘 오후 이용 예정인데 스터디룸이 조금 덥게 느껴집니다. 확인 부탁드려요.',reply:'말씀해 주셔서 감사합니다. 현재 냉방 상태를 점검하고 있습니다.'},
    {id:2,title:'이용권 연장 방법을 알고 싶어요',member:'이서준',branch:'gangnam',category:'이용권',assignee:'junho',status:'할 일',desc:'현재 이용 중인 4주 이용권을 연장하려면 어떻게 해야 하나요?',reply:''},
    {id:3,title:'사물함 비밀번호 초기화 요청',member:'정수빈',branch:'seongsu',category:'사물함',assignee:'yujin',status:'완료',desc:'사물함 비밀번호를 잊어버렸어요.',reply:'본인 확인 후 비밀번호 초기화를 도와드렸습니다.'}
  ],
  notices: [
    {id:1,title:'10월 정기 소독 및 시설 점검 안내',branch:'all',pinned:true,category:'운영 안내',date:'2026-10-17',author:'owner',body:'10월 24일 오전 7시부터 9시까지 전 지점 정기 소독을 진행합니다.\n\n각 지점 매니저는 전날 안내문을 게시하고, 오픈 전 환기 및 시설 상태를 확인해 주세요. 이용 회원의 개인 물품은 이동하지 않습니다.'},
    {id:2,title:'교대 인수인계, 이렇게 남겨 주세요',branch:'all',pinned:true,category:'업무 가이드',date:'2026-10-16',author:'owner',body:'교대 전 운영 채널에 다음 항목을 남겨 주세요.\n\n1. 미완료 업무와 담당자\n2. 고객 요청 사항\n3. 시설 및 소모품 특이 사항\n\n관련 업무 카드를 함께 공유하면 더 빠르게 확인할 수 있어요.'},
    {id:3,title:'강남점 스터디룸 이용 안내 업데이트',branch:'gangnam',pinned:false,category:'지점 소식',date:'2026-10-15',author:'minji',body:'스터디룸 퇴실 10분 전 안내 문구가 변경되었습니다. 새 안내문은 데스크 서랍에서 확인해 주세요.'},
    {id:4,title:'성수점 라운지 정리 안내',branch:'seongsu',pinned:false,category:'지점 소식',date:'2026-10-14',author:'yujin',body:'라운지 공용 도서 위치를 정리했습니다. 이용 후 제자리에 놓을 수 있도록 안내해 주세요.'}
  ]
};

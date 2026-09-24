/**
 * Data wilayah Indonesia (subset representatif untuk demo frontend-only).
 * Struktur: Provinsi -> Kota/Kabupaten -> Kecamatan -> Kelurahan
 * Pada implementasi produksi, ganti dengan API wilayah (mis. dataset Kemendagri).
 */

export interface Wilayah {
  [province: string]: {
    [city: string]: {
      [district: string]: string[]
    }
  }
}

export const WILAYAH: Wilayah = {
  'Jawa Barat': {
    'Kota Bandung': {
      'Coblong': ['Dago', 'Cipaganti', 'Lebak Gede', 'Lebak Siliwangi', 'Sadang Serang', 'Sekeloa'],
      'Sukajadi': ['Cipedes', 'Sukagalih', 'Sukabungah', 'Pasteur', 'Sukawarna'],
      'Lengkong': ['Burangrang', 'Cijagra', 'Lingkar Selatan', 'Malabar', 'Paledang', 'Turangga'],
      'Cidadap': ['Ciumbuleuit', 'Hegarmanah', 'Ledeng'],
      'Bandung Wetan': ['Cihapit', 'Citarum', 'Tamansari'],
    },
    'Kota Bekasi': {
      'Bekasi Selatan': ['Jaka Mulya', 'Jaka Setia', 'Pekayon Jaya', 'Marga Jaya', 'Kayuringin Jaya'],
      'Bekasi Timur': ['Aren Jaya', 'Bekasi Jaya', 'Duren Jaya', 'Margahayu'],
      'Bekasi Utara': ['Harapan Baru', 'Kaliabang Tengah', 'Perwira', 'Teluk Pucung'],
    },
    'Kota Depok': {
      'Beji': ['Beji', 'Beji Timur', 'Kemiri Muka', 'Pondok Cina', 'Kukusan', 'Tanah Baru'],
      'Pancoran Mas': ['Depok', 'Depok Jaya', 'Mampang', 'Rangkapan Jaya'],
      'Cimanggis': ['Cisalak Pasar', 'Curug', 'Harjamukti', 'Mekarsari', 'Tugu'],
    },
    'Kota Bogor': {
      'Bogor Tengah': ['Babakan', 'Cibogor', 'Gudang', 'Panaragan', 'Pabaton', 'Sempur'],
      'Bogor Barat': ['Balumbang Jaya', 'Curug', 'Loji', 'Menteng', 'Pasir Kuda'],
    },
    'Kabupaten Bandung': {
      'Dayeuhkolot': ['Citeureup', 'Dayeuhkolot', 'Pasawahan', 'Sukapura'],
      'Cileunyi': ['Cibiru Wetan', 'Cileunyi Kulon', 'Cileunyi Wetan', 'Cinunuk'],
    },
  },
  'DKI Jakarta': {
    'Jakarta Selatan': {
      'Kebayoran Baru': ['Gandaria Utara', 'Gunung', 'Kramat Pela', 'Melawai', 'Pulo', 'Senayan'],
      'Tebet': ['Bukit Duri', 'Kebon Baru', 'Manggarai', 'Menteng Dalam', 'Tebet Barat', 'Tebet Timur'],
      'Pancoran': ['Cikoko', 'Duren Tiga', 'Kalibata', 'Pengadegan', 'Rawajati'],
      'Setiabudi': ['Guntur', 'Karet', 'Kuningan Timur', 'Menteng Atas', 'Pasar Manggis', 'Setiabudi'],
    },
    'Jakarta Pusat': {
      'Menteng': ['Cikini', 'Gondangdia', 'Kebon Sirih', 'Menteng', 'Pegangsaan'],
      'Tanah Abang': ['Bendungan Hilir', 'Gelora', 'Kampung Bali', 'Karet Tengsin', 'Kebon Kacang', 'Petamburan'],
    },
    'Jakarta Barat': {
      'Kebon Jeruk': ['Duri Kepa', 'Kebon Jeruk', 'Kedoya Selatan', 'Kelapa Dua', 'Sukabumi Utara'],
      'Grogol Petamburan': ['Grogol', 'Jelambar', 'Tanjung Duren Selatan', 'Tomang', 'Wijaya Kusuma'],
    },
    'Jakarta Timur': {
      'Jatinegara': ['Bali Mester', 'Bidara Cina', 'Cipinang Besar Utara', 'Kampung Melayu', 'Rawa Bunga'],
      'Duren Sawit': ['Duren Sawit', 'Klender', 'Malaka Jaya', 'Pondok Bambu', 'Pondok Kelapa'],
    },
    'Jakarta Utara': {
      'Kelapa Gading': ['Kelapa Gading Barat', 'Kelapa Gading Timur', 'Pegangsaan Dua'],
      'Tanjung Priok': ['Kebon Bawang', 'Papanggo', 'Sungai Bambu', 'Sunter Agung', 'Warakas'],
    },
  },
  'Jawa Tengah': {
    'Kota Semarang': {
      'Tembalang': ['Bulusan', 'Kramas', 'Meteseh', 'Sendangmulyo', 'Tembalang'],
      'Banyumanik': ['Banyumanik', 'Padangsari', 'Pedalangan', 'Srondol Wetan', 'Sumurboto'],
      'Semarang Selatan': ['Barusari', 'Bulustalan', 'Lamper Kidul', 'Mugassari', 'Peterongan'],
    },
    'Kota Surakarta': {
      'Jebres': ['Jebres', 'Kentingan', 'Mojosongo', 'Pucangsawit', 'Tegalharjo'],
      'Laweyan': ['Karangasem', 'Laweyan', 'Pajang', 'Penumping', 'Sondakan'],
    },
  },
  'DI Yogyakarta': {
    'Kota Yogyakarta': {
      'Gondokusuman': ['Baciro', 'Demangan', 'Klitren', 'Kotabaru', 'Terban'],
      'Umbulharjo': ['Giwangan', 'Muja Muju', 'Pandeyan', 'Sorosutan', 'Warungboto'],
      'Mergangsan': ['Brontokusuman', 'Keparakan', 'Wirogunan'],
    },
    'Kabupaten Sleman': {
      'Depok': ['Caturtunggal', 'Condongcatur', 'Maguwoharjo'],
      'Ngaglik': ['Donoharjo', 'Sardonoharjo', 'Sinduharjo', 'Sukoharjo'],
      'Mlati': ['Sendangadi', 'Sinduadi', 'Tirtoadi', 'Tlogoadi'],
    },
  },
  'Jawa Timur': {
    'Kota Surabaya': {
      'Gubeng': ['Airlangga', 'Baratajaya', 'Gubeng', 'Kertajaya', 'Mojo', 'Pucang Sewu'],
      'Sukolilo': ['Gebang Putih', 'Keputih', 'Klampis Ngasem', 'Menur Pumpungan', 'Semolowaru'],
      'Wonokromo': ['Darmo', 'Jagir', 'Ngagel', 'Sawunggaling', 'Wonokromo'],
    },
    'Kota Malang': {
      'Lowokwaru': ['Dinoyo', 'Jatimulyo', 'Ketawanggede', 'Merjosari', 'Sumbersari', 'Tulusrejo'],
      'Klojen': ['Kauman', 'Kiduldalem', 'Oro-oro Dowo', 'Penanggungan', 'Rampal Celaket'],
    },
  },
  'Banten': {
    'Kota Tangerang Selatan': {
      'Serpong': ['Buaran', 'Ciater', 'Rawa Buntu', 'Serpong', 'Lengkong Gudang'],
      'Pamulang': ['Benda Baru', 'Pamulang Barat', 'Pamulang Timur', 'Pondok Cabe Ilir'],
      'Ciputat': ['Cipayung', 'Ciputat', 'Jombang', 'Sawah Baru'],
    },
    'Kota Tangerang': {
      'Cipondoh': ['Cipondoh', 'Gondrong', 'Kenanga', 'Petir', 'Poris Plawad'],
      'Karawaci': ['Bojong Jaya', 'Cimone', 'Karawaci', 'Nusa Jaya', 'Sukajadi'],
    },
  },
  'Bali': {
    'Kota Denpasar': {
      'Denpasar Selatan': ['Panjer', 'Renon', 'Sanur', 'Sesetan', 'Sidakarya'],
      'Denpasar Barat': ['Dauh Puri', 'Padangsambian', 'Pemecutan', 'Tegal Harum'],
    },
    'Kabupaten Badung': {
      'Kuta': ['Kuta', 'Legian', 'Seminyak', 'Tuban'],
      'Kuta Utara': ['Canggu', 'Dalung', 'Kerobokan', 'Tibubeneng'],
    },
  },
  'Sumatera Utara': {
    'Kota Medan': {
      'Medan Baru': ['Babura', 'Darat', 'Merdeka', 'Padang Bulan', 'Petisah Hulu', 'Titi Rantai'],
      'Medan Selayang': ['Asam Kumbang', 'Beringin', 'Padang Bulan Selayang I', 'Sempakata', 'Tanjung Sari'],
    },
  },
  'Sulawesi Selatan': {
    'Kota Makassar': {
      'Tamalanrea': ['Bura Sipala', 'Kapasa', 'Parangloe', 'Tamalanrea', 'Tamalanrea Indah'],
      'Rappocini': ['Ballaparang', 'Banta-Bantaeng', 'Gunung Sari', 'Karunrung', 'Rappocini'],
    },
  },
}

export const PROVINCES = Object.keys(WILAYAH).sort()

export const getCities = (province: string) =>
  province && WILAYAH[province] ? Object.keys(WILAYAH[province]).sort() : []

export const getDistricts = (province: string, city: string) =>
  province && city && WILAYAH[province]?.[city] ? Object.keys(WILAYAH[province][city]).sort() : []

export const getSubdistricts = (province: string, city: string, district: string) =>
  WILAYAH[province]?.[city]?.[district] ? [...WILAYAH[province][city][district]].sort() : []

/** Approximate city centroid for map pin defaults. */
export const CITY_COORDS: Record<string, [number, number]> = {
  'Kota Bandung': [-6.9175, 107.6191],
  'Kota Bekasi': [-6.2383, 106.9756],
  'Kota Depok': [-6.4025, 106.7942],
  'Kota Bogor': [-6.595, 106.8166],
  'Kabupaten Bandung': [-7.0251, 107.5199],
  'Jakarta Selatan': [-6.2615, 106.8106],
  'Jakarta Pusat': [-6.1805, 106.8284],
  'Jakarta Barat': [-6.1683, 106.7588],
  'Jakarta Timur': [-6.2251, 106.9004],
  'Jakarta Utara': [-6.1214, 106.8744],
  'Kota Semarang': [-6.9932, 110.4203],
  'Kota Surakarta': [-7.5755, 110.8243],
  'Kabupaten Sleman': [-7.7159, 110.3556],
  'Kota Yogyakarta': [-7.7956, 110.3695],
  'Kota Surabaya': [-7.2575, 112.7521],
  'Kota Malang': [-7.9666, 112.6326],
  'Kota Tangerang Selatan': [-6.2884, 106.7179],
  'Kota Tangerang': [-6.1783, 106.63],
  'Kota Denpasar': [-8.6705, 115.2126],
  'Kabupaten Badung': [-8.6478, 115.1786],
  'Kota Medan': [3.5952, 98.6722],
  'Kota Makassar': [-5.1477, 119.4327],
}

export const DEFAULT_COORDS: [number, number] = [-6.2088, 106.8456]

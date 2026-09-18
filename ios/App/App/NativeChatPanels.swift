import UIKit
import Photos

/// All secondary chat screens are UIKit controllers. None display WKWebView content.
final class NativeChatPicker: UITableViewController, UISearchResultsUpdating {
    struct Item {
        let title: String
        let detail: String
        var image: String? = nil
        let choose: () -> Void
    }
    var items: [Item] = [] { didSet { filter() } }
    var loadNext: (() -> Void)?
    var searchChanged: ((String) -> Void)?
    private var shown: [Item] = []
    private let search = UISearchController(searchResultsController: nil)
    init(title: String, searchable: Bool = true) {
        super.init(style: .plain); self.title = title
        if searchable {
            search.searchResultsUpdater = self; search.obscuresBackgroundDuringPresentation = false
            search.searchBar.placeholder = "검색"; navigationItem.searchController = search
            navigationItem.hidesSearchBarWhenScrolling = false
        }
    }
    required init?(coder: NSCoder) { fatalError() }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        tableView.rowHeight = 78
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "닫기", style: .done, target: self, action: #selector(close))
        tableView.accessibilityIdentifier = "native-chat-panel-list"
        if loadNext != nil {
            let more = UIButton(type: .system); more.setTitle("더 보기", for: .normal)
            more.frame.size.height = 52
            more.addAction(UIAction { [weak self] _ in self?.loadNext?() }, for: .touchUpInside)
            tableView.tableFooterView = more
        }
    }
    @objc private func close() { dismiss(animated: true) }
    func updateSearchResults(for searchController: UISearchController) {
        if let callback = searchChanged { callback(searchController.searchBar.text ?? "") }
        else { filter() }
    }
    private func filter() {
        let q = search.searchBar.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        shown = searchChanged != nil || q.isEmpty ? items : items.filter { ($0.title + $0.detail).localizedCaseInsensitiveContains(q) }
        tableView.reloadData()
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { shown.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        let item = shown[indexPath.row]
        cell.textLabel?.text = item.title; cell.textLabel?.numberOfLines = 1
        cell.detailTextLabel?.text = item.detail; cell.detailTextLabel?.numberOfLines = 2
        cell.detailTextLabel?.textColor = .secondaryLabel
        cell.accessoryType = .disclosureIndicator
        if let url = item.image {
            cell.imageView?.image = UIImage(systemName: "photo")
            ImageStore.shared.load(url) { [weak cell] shot in
                guard let cell = cell else { return }
                cell.imageView?.image = shot?.first; cell.setNeedsLayout()
            }
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true); shown[indexPath.row].choose()
    }
}

final class NativeChatText: UIViewController {
    private let text: String
    init(_ text: String) { self.text = text; super.init(nibName: nil, bundle: nil); title = "선택 복사" }
    required init?(coder: NSCoder) { fatalError() }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemBackground
        let field = UITextView(); field.text = text; field.isEditable = false; field.isSelectable = true
        field.font = .preferredFont(forTextStyle: .body); field.dataDetectorTypes = [.link, .phoneNumber]
        field.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(field)
        NSLayoutConstraint.activate([field.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            field.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            field.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            field.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16)])
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "닫기", style: .done, target: self, action: #selector(close))
    }
    @objc private func close() { dismiss(animated: true) }
}

/**
 * 사진을 크게 본다 — **검은 바탕에 `✕`는 오른쪽 위, `저장`·`공유`는
 * 아래 흰 알약**이다(웹의 `.photo-zoom`과 같은 짜임).
 *
 * **분홍을 안 쓴다** — 이 화면에서 '지금 눌러야 할 것'은 보내기 단추
 * 하나다. **칠은 흰색 30%다**: 16%로 두었더니 검은 바탕에서 단추로
 * 안 읽혔다(사용자 제보 — `시인성이 좀 떨어져`). 44px로 둔다.
 *
 * **단추를 눌러도 창이 안 닫힌다** — 닫는 것은 `✕`와 사진 바깥이다.
 */
final class NativeChatPhoto: UIViewController, UIScrollViewDelegate {
    private let url: String
    private let scroll = UIScrollView()
    private let photo = UIImageView()
    private let closeBtn = UIButton(type: .system)
    private let saveBtn = UIButton(type: .system)
    private let shareBtn = UIButton(type: .system)
    /// 저장이 도는 동안 잠근다 — 몇 초 걸리는데 아무 말이 없으면 안 된
    /// 줄 알고 또 눌러 **같은 사진이 여러 장 저장된다**(사용자 제보).
    private var busy = false

    init(_ url: String) {
        self.url = url
        super.init(nibName: nil, bundle: nil)
        title = "사진"
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        scroll.delegate = self; scroll.minimumZoomScale = 1; scroll.maximumZoomScale = 5
        scroll.frame = view.bounds; scroll.autoresizingMask = [.flexibleWidth, .flexibleHeight]; view.addSubview(scroll)
        photo.frame = scroll.bounds; photo.autoresizingMask = [.flexibleWidth, .flexibleHeight]; photo.contentMode = .scaleAspectFit
        scroll.addSubview(photo)
        ImageStore.shared.load(url) { [weak self] shot in
            guard let self = self else { return }; ImageStore.put(shot, into: self.photo)
        }
        closeBtn.setImage(UIImage(systemName: "xmark"), for: .normal)
        closeBtn.tintColor = .white
        closeBtn.accessibilityLabel = "닫기"
        closeBtn.addTarget(self, action: #selector(close), for: .touchUpInside)
        pill(saveBtn, "저장", #selector(save))
        pill(shareBtn, "공유", #selector(share))
        for v in [closeBtn, saveBtn, shareBtn] as [UIView] { view.addSubview(v) }
        /* 사진 바깥을 누르면 닫힌다 — 사진 자체는 벌려서 키우는 자리다. */
        let tap = UITapGestureRecognizer(target: self, action: #selector(close))
        scroll.addGestureRecognizer(tap)
    }

    private func pill(_ b: UIButton, _ text: String, _ action: Selector) {
        b.setTitle(text, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        b.backgroundColor = UIColor(white: 1, alpha: 0.3)
        b.layer.cornerRadius = 22
        b.layer.borderWidth = 1
        b.layer.borderColor = UIColor(white: 1, alpha: 0.25).cgColor
        b.addTarget(self, action: action, for: .touchUpInside)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let top = view.safeAreaInsets.top
        closeBtn.frame = CGRect(x: view.bounds.width - 52, y: top + 4, width: 44, height: 44)
        let w: CGFloat = 96
        let y = view.bounds.height - view.safeAreaInsets.bottom - 60
        saveBtn.frame = CGRect(x: view.bounds.width / 2 - w - 6, y: y, width: w, height: 44)
        shareBtn.frame = CGRect(x: view.bounds.width / 2 + 6, y: y, width: w, height: 44)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { photo }
    @objc private func close() { dismiss(animated: true) }

    @objc private func share() {
        guard let image = photo.image else { return }
        let activity = UIActivityViewController(activityItems: [image], applicationActivities: nil)
        activity.popoverPresentationController?.sourceView = shareBtn
        activity.popoverPresentationController?.sourceRect = shareBtn.bounds
        present(activity, animated: true)
    }

    /// **저장이 끝나야 답한다** — 부르자마자 `저장했습니다`를 띄우면
    /// 권한을 거절당해 정말로 안 저장된 때도 그렇게 뜬다.
    @objc private func save() {
        guard !busy, let image = photo.image else { return }
        busy = true
        saveBtn.setTitle("저장 중…", for: .normal)
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { [weak self] status in
            guard status == .authorized || status == .limited else {
                DispatchQueue.main.async { self?.done("설정에서 사진 추가 권한을 허용해 주세요.") }; return
            }
            PHPhotoLibrary.shared().performChanges({ PHAssetChangeRequest.creationRequestForAsset(from: image) }) { ok, _ in
                DispatchQueue.main.async { self?.done(ok ? "사진첩에 저장했습니다." : "사진을 저장하지 못했습니다.") }
            }
        }
    }

    private func done(_ text: String) {
        busy = false
        saveBtn.setTitle("저장", for: .normal)
        ToastHUD.show(text, skin: ToastHUD.Skin(), in: view, above: saveBtn)
    }
}

final class NativeStickerCell: UICollectionViewCell {
    let picture = UIImageView()
    let name = UILabel()
    private var url = ""
    override init(frame: CGRect) {
        super.init(frame: frame)
        picture.contentMode = .scaleAspectFit; name.font = .systemFont(ofSize: 11); name.textAlignment = .center
        contentView.addSubview(picture); contentView.addSubview(name)
        isAccessibilityElement = true
    }
    required init?(coder: NSCoder) { fatalError() }
    override func layoutSubviews() {
        super.layoutSubviews()
        let foot: CGFloat = name.isHidden ? 0 : 22
        picture.frame = CGRect(x: 4, y: 3, width: bounds.width - 8, height: bounds.height - foot - 6)
        name.frame = CGRect(x: 0, y: bounds.height - 22, width: bounds.width, height: 20)
    }
    /// `compact`면 이름을 안 적는다 — 서랍은 다섯 칸 격자라 한 칸이
    /// 64px 언저리이고, 거기서 이름까지 적으면 그림이 손톱만 해진다
    /// (웹의 `.sticker-btn`도 그림 하나뿐이다).
    func show(_ item: ChatJSON, compact: Bool = false) {
        url = item["src"] as? String ?? ""; let expected = url
        name.text = compact ? nil : item["label"] as? String
        name.isHidden = compact
        accessibilityLabel = item["label"] as? String
        ImageStore.put(nil, into: picture)
        ImageStore.shared.load(url) { [weak self] shot in
            guard let self = self, self.url == expected else { return }; ImageStore.put(shot, into: self.picture)
        }
    }
    override func prepareForReuse() { super.prepareForReuse(); url = ""; ImageStore.put(nil, into: picture) }
}

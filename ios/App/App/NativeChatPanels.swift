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

final class NativeChatPhoto: UIViewController, UIScrollViewDelegate {
    private let url: String
    private let scroll = UIScrollView()
    private let photo = UIImageView()
    init(_ url: String) { self.url = url; super.init(nibName: nil, bundle: nil); title = "사진" }
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
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "닫기", style: .done, target: self, action: #selector(close))
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(barButtonSystemItem: .action, target: self, action: #selector(share)),
            UIBarButtonItem(title: "저장", style: .plain, target: self, action: #selector(save))]
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { photo }
    @objc private func close() { dismiss(animated: true) }
    @objc private func share() {
        guard let image = photo.image else { return }
        let activity = UIActivityViewController(activityItems: [image], applicationActivities: nil)
        activity.popoverPresentationController?.barButtonItem = navigationItem.rightBarButtonItems?.first
        present(activity, animated: true)
    }
    @objc private func save() {
        guard let image = photo.image else { return }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { [weak self] status in
            guard status == .authorized || status == .limited else {
                DispatchQueue.main.async { self?.notice("설정에서 사진 추가 권한을 허용해 주세요.") }; return
            }
            PHPhotoLibrary.shared().performChanges({ PHAssetChangeRequest.creationRequestForAsset(from: image) }) { ok, _ in
                DispatchQueue.main.async { self?.notice(ok ? "사진을 저장했습니다." : "사진을 저장하지 못했습니다.") }
            }
        }
    }
    private func notice(_ text: String) {
        let alert = UIAlertController(title: text, message: nil, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default)); present(alert, animated: true)
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
        picture.frame = CGRect(x: 4, y: 0, width: bounds.width - 8, height: bounds.height - 22)
        name.frame = CGRect(x: 0, y: bounds.height - 22, width: bounds.width, height: 20)
    }
    func show(_ item: ChatJSON) {
        url = item["src"] as? String ?? ""; let expected = url
        name.text = item["label"] as? String; accessibilityLabel = name.text
        ImageStore.put(nil, into: picture)
        ImageStore.shared.load(url) { [weak self] shot in
            guard let self = self, self.url == expected else { return }; ImageStore.put(shot, into: self.picture)
        }
    }
    override func prepareForReuse() { super.prepareForReuse(); url = ""; ImageStore.put(nil, into: picture) }
}

final class NativeStickerPicker: UIViewController, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
    private let groups: [ChatJSON]
    private var group = 0
    private let collection = UICollectionView(frame: .zero, collectionViewLayout: UICollectionViewFlowLayout())
    private let tabs = UIScrollView()
    var selected: ((ChatJSON) -> Void)?
    init(_ groups: [ChatJSON]) { self.groups = groups; super.init(nibName: nil, bundle: nil); title = "이모티콘" }
    required init?(coder: NSCoder) { fatalError() }
    private var items: [ChatJSON] { groups.indices.contains(group) ? groups[group]["stickers"] as? [ChatJSON] ?? [] : [] }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemBackground
        collection.dataSource = self; collection.delegate = self
        collection.register(NativeStickerCell.self, forCellWithReuseIdentifier: "sticker")
        collection.backgroundColor = .systemBackground
        tabs.showsHorizontalScrollIndicator = false
        view.addSubview(tabs); view.addSubview(collection)
        for (i, g) in groups.enumerated() {
            let button = UIButton(type: .system)
            button.setTitle("\(g["tab"] as? String ?? "") \(g["name"] as? String ?? "")", for: .normal)
            button.frame = CGRect(x: i * 115, y: 0, width: 115, height: 48)
            button.addAction(UIAction { [weak self] _ in
                self?.group = i; self?.collection.setContentOffset(.zero, animated: false); self?.collection.reloadData()
            }, for: .touchUpInside)
            tabs.addSubview(button)
        }
        tabs.contentSize = CGSize(width: groups.count * 115, height: 48)
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "닫기", style: .done, target: self, action: #selector(close))
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let top = view.safeAreaInsets.top
        tabs.frame = CGRect(x: 0, y: top, width: view.bounds.width, height: 48)
        collection.frame = CGRect(x: 8, y: top + 48, width: view.bounds.width - 16, height: view.bounds.height - top - 48)
    }
    @objc private func close() { dismiss(animated: true) }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { items.count }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "sticker", for: indexPath) as! NativeStickerCell
        cell.show(items[indexPath.item]); return cell
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        let item = items[indexPath.item]; dismiss(animated: true) { self.selected?(item) }
    }
    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
        let width = floor((collectionView.bounds.width - 24) / 3)
        return CGSize(width: width, height: width + 20)
    }
}
